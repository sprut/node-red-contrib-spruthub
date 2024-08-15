const SprutHubHelper = require('../lib/SprutHubHelper.js');
var WebSocket = require('../lib/rpc-websockets').Client;

module.exports = function(RED) {
  class ServerNode {

    constructor(n) {
      RED.nodes.createNode(this, n);

      var node = this;
      node.config = n;
      node.connection = false;
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
          node.ws.call('', {account:{login:{login:node.credentials.api_email}}}).then(function(result) {
            //console.log('result', JSON.stringify(result))
            if (result.account.login.question?.type === 'QUESTION_TYPE_PASSWORD') {
              //console.log('do auth', node.credentials.api_password)
              node.ws.call('', {account:{answer:{data:node.credentials.api_password}}}).then(function(result) {
                //console.log('result ans ', JSON.stringify(result))
                if (result.account.answer.status === 'ACCOUNT_RESPONSE_SUCCESS') {
                  node.log('Logged in as ' + node.credentials.api_email);
                  const token = result.account.answer.token
                  node.credentials.api_token = token;
                  node.ws.setApiToken(token);

                  node.ws.call('', {server:{version:{}}}).then(function(result) {
                    node.log('SprutHub version: v'+ result.server.version.version + ' (' + result.server.version.revision + ') ' + result.server.version.branch);
                  }).catch(function(error) {
                    node.error('Failed to get SprutHub version: ' + error);
                  });
                  node.getServiceTypes().then(()=>{
                    node.getAccessories().then(()=>{
                      node.emit('onConnected');
                    }).catch(error => {
                      node.error(error);
                    });
                  }).catch(error => {
                    node.error(error);
                  });
                } else {
                  node.error('Auth failed: - ' + result.account.answer.message);
                }
              })
            } else {
              node.error('Auth failed: - incorrect auth');
            }
          }).catch(function(error) {
            node.error('Auth failed: ' + JSON.stringify(error));
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
          //console.log('test', config.email)
          await ws.call('', {account:{login:{login:config.email}}}).then(async function(result) {
            //console.log('result', JSON.stringify(result))
            if (result.account.login.question?.type === 'QUESTION_TYPE_PASSWORD') {
              await ws.call('', {account:{answer:{data:config.password}}}).then(function(result) {
                //console.log('result ans ', JSON.stringify(result))
                if (result.account.answer.status === 'ACCOUNT_RESPONSE_SUCCESS') {
                  ws.setApiToken(result.account.answer.token);
                } else {
                  reject({message: 'jRPC: login failed - ' + result.account.answer.message});  
                }
              }).catch(function(error) {
                reject({message: 'jRPC: login failed', error: error});
              });
            } else {
              reject({message: 'jRPC: login failed - incorrect auth'});  
            }
          }).catch(function(error) {
            reject({message: 'jRPC: login failed', error: error});
          });

          await ws.call('', {server:{version:{}}}).then(function(data) {
            resolve(data.server.version);
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
      var characteristic = null;
      for (var i in data) {
        for (var i2 in data[i]['services']) {
          for (var i3 in data[i]['services'][i2]['characteristics']) {
            characteristic = data[i]['services'][i2]['characteristics'][i3];
            key = characteristic['aId'] + '_' + characteristic['sId'];
            val = 'value' in characteristic ? characteristic['value'] : null;

            if (!(key in values)) values[key] = {};
            values[key][parseInt(characteristic['cId'])] = SprutHubHelper.convertVarType(val);
          }
        }
      }

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

