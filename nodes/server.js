const SprutHubHelper = require('../lib/SprutHubHelper.js');
const { signChallenge } = require('../lib/SprutHubAuth.js');
var WebSocket = require('../lib/rpc-websockets').Client;

module.exports = function(RED) {
  class ServerNode {

    constructor(n) {
      RED.nodes.createNode(this, n);

      var node = this;
      node.config = n;
      node.connection = false;
      node.revision = undefined;
      node.rooms = undefined;
      node.accessories = undefined;
      node.service_types = undefined;
      node.items = undefined;
      node.devices = undefined;
      node.current_values = {};
      node.bridge_config = null;
      node.bridge_state = null;
      node.connectionTimer = null;
      node.connectionTimerFlag = false;
      node.ws = null;
      node.on('close', () => this.onClose());
      node.setMaxListeners(0);

      node.initJsonRpc();
    }

    getBaseTopic() {
      return '/spruthub';
    }

    async doAuth(ws, email, password) {
      let response;
      try {
        response = (await ws.call('', {account:{auth:{}}})).account.auth;
      } catch (error) {
        // no account.auth in revisions below 13872
        return this.doLegacyAuth(ws, email, password);
      }

      // Question flow: EMAIL -> PASSWORD (legacy account) or CHALLENGE (auth v2) -> token
      const answered = {};
      let lastQuestion = 'account.auth';
      for (let step = 0; step < 5; step++) {
        if (response.status && response.status !== 'ACCOUNT_RESPONSE_SUCCESS') {
          throw 'Auth failed on ' + lastQuestion + ': ' + (response.label?.error || response.status);
        }
        if (response.token) {
          ws.setApiToken(response.token);
          return response.token;
        }

        const question = response.question || {};
        if (answered[question.type]) {
          throw 'Auth failed: ' + question.type + ' asked again';
        }
        answered[question.type] = true;

        let data;
        switch (question.type) {
          case 'QUESTION_TYPE_EMAIL':
            data = email;
            break;
          case 'QUESTION_TYPE_PASSWORD':
            data = password;
            break;
          case 'QUESTION_TYPE_CHALLENGE':
            try {
              data = await signChallenge(password, question.data);
            } catch (error) {
              throw 'Auth failed: challenge ' + (error.message || error);
            }
            break;
          default:
            // CAPTCHA / PIN / ENROLL etc. need user interaction: log in once via web interface
            throw 'Auth failed: unsupported question ' + (question.type || JSON.stringify(response));
        }

        if (question.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(question.delay, 60) * 1000));
        }

        lastQuestion = question.type;
        try {
          response = (await ws.call('', {account:{answer:{data: data}}})).account.answer;
        } catch (error) {
          throw 'Auth failed: ' + question.type + ' ' + JSON.stringify(error);
        }
      }
      throw 'Auth failed: too many questions';
    }

    // account.login flow for revisions below 13872
    async doLegacyAuth(ws, email, password) {
      let result;
      try {
        result = await ws.call('', {account:{login:{login: email}}});
      } catch (error) {
        throw 'Auth failed: ' + JSON.stringify(error);
      }
      if (result.account.login.question?.type !== 'QUESTION_TYPE_PASSWORD') {
        throw 'Auth failed: - incorrect auth';
      }

      try {
        result = await ws.call('', {account:{answer:{data: password}}});
      } catch (error) {
        throw 'Auth failed: ' + JSON.stringify(error);
      }
      if (result.account.answer.status !== 'ACCOUNT_RESPONSE_SUCCESS') {
        throw 'Auth failed: - ' + result.account.answer.message;
      }

      const token = result.account.answer.token;
      ws.setApiToken(token);
      return token;
    }

    async getServerVersion(ws) {
      try {
        const result = await ws.call('', {server:{version:{}}})
        return result.server.version;
      } catch (error) {
        try {
          const result = await ws.call('', {hub:{list:{}}})
          const hub = result.hub.list.hubs[0];
          const version = hub.version;
          const current = version.current;
          const res = {
            revision: current.revision,
            version: current.version,
            branch: version.branch
          };
          return res;
        } catch (error2) {
          throw "Failed to get SprutHub version: " + JSON.stringify(error) + " - " + JSON.stringify(error2);
        }
      }
    }

    async authDone(token) {
      // console.log('authDone', token)
      let node = this;
      node.credentials.api_token = token;

      const serverVersion = await node.getServerVersion(node.ws)
      node.revision = serverVersion.revision;
      node.log('SprutHub version: v'+ serverVersion.version + ' (' + serverVersion.revision + ') ' + serverVersion.branch);

      await node.getServiceTypes();
      await node.getAccessories();
      node.emit('onConnected');
    }

    initJsonRpc() {
      let node = this;
      node.ws = new WebSocket('ws://' + node.config.host + ':' + node.config.api_port + '/spruthub', {
        autoconnect: true,
        reconnect: true,
        reconnect_interval: 3000,
        max_reconnects: 480
      });

      node.ws.on('error', function(e) {
        // node.error('Websocket error: '+e.message);
      });
      node.ws.on('close', function() {
        node.connection = false;
        node.warn('SprutHub disconnected');
        node.emit('onDisconnected');
      });
      node.ws.on('open', function() {
        node.connection = true;

        // console.log('API TOKEN: '+node.ws.getApiToken());
        if (!node.ws.getApiToken()) {
          node.doAuth(node.ws, node.credentials.api_email, node.credentials.api_password).then(function(token) {
            node.log('Logged in as ' + node.credentials.api_email);
            node.authDone(token).catch(error => {
              node.error(error);
            })
          }).catch(error => {
            node.error(error);
          });
        } else {
          node.log('SprutHub reconnected');
          node.emit('onConnected');
        }
      });



      node.ws.on('message', function(message) {
        //node.log('message ' + JSON.stringify(message))
        if ('event' in message && 'characteristic' in message.event && message.event.characteristic.event == 'EVENT_UPDATE') {
          let data = message.event.characteristic.characteristics[0];

          //node.log('data ' + JSON.stringify(data))
          if (data.control != null) {
            Object.assign(data, data.control)
            delete data.control;
          }

          let service_id = data.aId + '_' + data.sId;
          if (!(service_id in node.current_values)) node.current_values[service_id] = {};

          let last_value = node.current_values[service_id][data.cId];

          node.current_values[service_id][data.cId] = SprutHubHelper.convertVarType(data.value);

          node.emit('onMessage', {
            topic: node.getBaseTopic() + '/accessories/' + data.aId + '/' + data.sId + '/#',
            service_id: service_id,
            aid: data.aId,
            sid: data.sId,
            cid: data.cId,
            value: node.current_values[service_id][data.cId],
            last_value: last_value
          });
        }
      });
    }

    async getRooms() {
      let node = this;
      if (!node.rooms) {
        return await new Promise(function(resolve, reject) {
          node.ws.call('', {room:{list:{}}}, 20000).then(function(result) {
            let data = JSON.stringify(result.room.list);
            if (SprutHubHelper.isJson(data)) {
              
              const rooms = JSON.parse(data).rooms;
              const res = {};
              rooms.forEach((room) => {
                res[room["id"]] = {name: room["name"]}
              });
              //node.log('get room done' + JSON.stringify(res))
              node.rooms = res;
              resolve(res);
            } else {
              reject('getRooms: not JSON in the answer');
            }
          }).catch(function(error) {
            node.error('ERROR #2342: ' + error.message);
            reject(error);
          });
        }).catch(function(error) {
          node.error('ERROR #2350: ' + error.message);
        });
      } else {
        return node.rooms;
      }
    }

    async getAccessories(force = false) {
      let node = this;
      //node.log('get acc')
      if (force || !node.accessories) {
        const rooms = await this.getRooms()
        return await new Promise(function(resolve, reject) {
          node.ws.call('', {accessory:{list:{"expand":"services+characteristics"}}}, 20000).then(function(result) {
            let data = JSON.stringify(result.accessory.list);
            if (SprutHubHelper.isJson(data)) {
              //node.log('get acc done')
              node.accessories = JSON.parse(data).accessories;
              node.accessories.forEach((accessory) => {
                if (accessory.roomId != null) {
                  accessory.roomName = rooms[accessory.roomId]?.name || ""
                }
              })
              node.saveCurrentValues(node.accessories);
              resolve(node.accessories);
            } else {
              reject('getAccessories: not JSON in the answer');
            }

          }).catch(function(error) {
            node.error('ERROR #2342: ' + error.message);
            reject(error);
          });
        }).catch(function(error) {
          node.error('ERROR #2341: ' + error.message);
        });

      } else {
        return node.accessories;
      }
    }

    async getServiceTypes() {
      let node = this;
      return await new Promise(function(resolve, reject) {
        //node.log('get service types')
        // console.time('service.list');
        node.ws.call('', {service:{types:{}}}, 20000).then(function(result) {
          let data = JSON.stringify(result.service.types);
          // console.timeEnd('service.list');
          // console.log('service.list size: ' + data.length);
          if (SprutHubHelper.isJson(data)) {
             node.service_types = JSON.parse(data).types;
             //node.log('get service types res ')// + data)
             resolve(node.service_types);
          } else {
            reject('getServiceTypes: not JSON in the answer');
          }

        }).catch(function(error) {
          node.error('ERROR #2347: ' + error.message);
          reject(error);
        });
      }).catch(function(error) {
        node.error('ERROR #2348: ' + error.message);
      });
    }

    async checkConnection(config) {
      // console.log('check ' + JSON.stringify(config))
      var node = this;

      var result = {
        'auth': false,
        'accessories_cnt': false,
        'version': false,
        'version_new': '',
        'error': null
      };

      var wsResult = await new Promise(function(resolve, reject) {
        var ws = new WebSocket('ws://' + config.host + ':' + config.port + '/spruthub', {
          autoconnect: true,
          reconnect: false,
          reconnect_interval: 0,
          max_reconnects: 0
        });
        ws.on('error', (error) => {
          reject({message: 'No connection', error: error});
        })
        ws.on('open', async function() {
          // console.log('test', config.email)
          await node.doAuth(ws, config.email, config.password).catch(function(error) {
            reject({message: 'jRPC: auth failed', error: error});
          });
          await node.getServerVersion(ws).then(function(version) {
            resolve(version);
          }).catch(function(error) {
            reject({message: 'jRPC: server.version failed', error: error});
          });
          ws.close();
        });
      }).catch(error => {
        result['error'] = error.message;
        node.warn(error);
      });

      if (wsResult && 'revision' in wsResult) {
        result['auth'] = true;
        result['version'] = wsResult.version + ' (' + wsResult.revision + ')';
        if ('lastVersion' in wsResult && wsResult.revision !== wsResult.lastRevision) {
          result['version_new'] = wsResult.lastVersion + ' (' + wsResult.lastRevision + ')';
        }
      }

      var accessories = await node.getAccessories().catch(error => {
        node.warn(error);
      });
      if (accessories) {
        result['accessories_cnt'] = Object.keys(accessories).length;
      }

      return result;
    }

    saveCurrentValues(data) {
      var node = this;

      var values = {};
      var key = null;
      var val = null;
      (data || []).forEach((a) => {
        (a.services || []).forEach((s) => {
          (s.characteristics || []).forEach((c) => {
            key = c.aId + '_' + c.sId;

            if (c.control != null) {
              Object.assign(c, c.control)
              delete c.control;
            }

            val = c.value || null;

            if (!(key in values)) {
              values[key] = {};
            }
            values[key][parseInt(c.cId)] = SprutHubHelper.convertVarType(val);
          })
        })
      })

      node.current_values = values;
      //node.log('save values done ')// + JSON.stringify(values))
    }

    getServiceType(uid, cid = null) {
      var node = this;

      //node.log('get serv type ' + uid + '--' + cid)
      if (!node.accessories) return {};

      var uidRaw = uid.split('_');
      var aid = uidRaw[0];
      var sid = uidRaw[1];
      cid = cid != '0' ? cid : false;

      var res = {};
      res['accessory'] = {};
      loop1:
          for (var i in node.accessories) {
            if (node.accessories[i]['id'] == aid) {
              loop2:
                  for (var i2 in node.accessories[i]['services']) {
                    if (node.accessories[i]['services'][i2]['sId'] == sid) {
                      res['service'] = node.accessories[i]['services'][i2];
                      if (cid) {
                        for (var i3 in node.accessories[i]['services'][i2]['characteristics']) {
                          // res['accessory'][node.accessories[i]['services'][i2]['characteristics'][i3]['type']] = node.accessories.accessories[i]['services'][i2]['characteristics'][i3];
                          if (node.accessories[i]['services'][i2]['characteristics'][i3]['cId'] == cid) {
                            res['characteristic'] = node.accessories[i]['services'][i2]['characteristics'][i3];
                          }
                        }
                      } else {
                        break loop1;
                      }
                    }

                    for (var i4 in node.accessories[i]['services']) {
                      var i4_type = node.accessories[i]['services'][i4]['type'];
                      if (!(i4_type in res['accessory'])) res['accessory'][i4_type] = {};

                      for (var i5 in node.accessories[i]['services'][i4]['characteristics']) {
                        var i5_type = node.accessories[i]['services'][i4]['characteristics'][i5]['type'];
                        if (!(i5_type in res['accessory'][i4_type])) res['accessory'][i4_type][i5_type] = {};

                        res['accessory'][i4_type][i5_type] = node.accessories[i]['services'][i4]['characteristics'][i5];//node.accessories.accessories[i]['services'][i4]['characteristics'];
                      }
                    }
                  }
            }
          }

      if (!cid) {
        return res;
      }

      var serviceType = {};
      loop1:
          for (var i in node.service_types) {
            if (res['service']['type'] == node.service_types[i]['type']) {
              loop2:
                  for (var i2 in node.service_types[i]['required']) {
                    if (node.service_types[i]['required'][i2]['type'] == res['characteristic']['type']) {
                      serviceType = node.service_types[i]['required'][i2];
                      break loop1;
                    }
                    if (node.service_types[i]['optional'][i2]['type'] == res['characteristic']['type']) {
                      serviceType = node.service_types[i]['optional'][i2];
                      break loop1;
                    }
                  }

            }
          }

      serviceType['service'] = res['service'];
      serviceType['accessory'] = res['accessory'];
      serviceType['characteristic'] = res['characteristic'];
      //node.log('get serv type resp' + JSON.stringify(serviceType))
      return serviceType;
    }

    onClose() {
      var node = this;
      node.connection = false;
      node.emit('onClose');
      node.log('Connection closed');
    }
  }

  RED.nodes.registerType('spruthub-server', ServerNode, {
    credentials: {
      api_email: {type: 'text'},
      api_password: {type: 'text'},
    },
  });
};

