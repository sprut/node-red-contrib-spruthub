const SprutHubHelper = require('../lib/SprutHubHelper.js');
var mqtt = require('mqtt');
var request = require('request');

module.exports = function (RED) {
    class ServerNode{
          constructor(n) {
            RED.nodes.createNode(this, n);

            var node = this;
            node.config = n;
            node.connection = false;
            node.base_topic = "/spruthub";
            node.spruthub_port = 55555;
            node.spruthub_token = null;
            node.mqtt_port = 44444;
            node.topic = node.config.base_topic+'/#';
            node.accessories = undefined;
            node.service_types = undefined;
            node.items = undefined;
            node.devices = undefined;
            node.current_values = {};
            node.bridge_config = null;
            node.bridge_state = null;
            node.on('close', () => this.onClose());
            node.setMaxListeners(0);

            node.init();
        }

        async init () {
            await this.getToken();
            await this.getAccessories();
            await this.getServiceTypes();

            //mqtt
            this.mqtt = this.connectMQTT();
            this.mqtt.on('connect', () => this.onMQTTConnect());
            this.mqtt.on('message', (topic, message) => this.onMQTTMessage(topic, message));
            this.mqtt.on('close', () => this.onMQTTClose());
            this.mqtt.on('end', () => this.onMQTTEnd());
            this.mqtt.on('reconnect', () => this.onMQTTReconnect());
            this.mqtt.on('offline', () => this.onMQTTOffline());
            this.mqtt.on('disconnect', (error) => this.onMQTTDisconnect(error));
            this.mqtt.on('error', (error) => this.onMQTTError(error));
        }

        getBaseTopic() {
            return this.base_topic;
        }

        connectMQTT(clientId = null) {
            var node = this;
            var options = {
                port: node.mqtt_port,
                username: node.config.mqtt_username||null,
                password: node.config.mqtt_password||null,
                clientId:"NodeRed-"+node.id+(clientId?"-"+clientId:"")
            };
            return mqtt.connect('mqtt://' + node.config.host, options);
        }

        subscribeMQTT() {
            var node = this;
            node.mqtt.subscribe(node.getBaseTopic()+'/accessories/#', function (err) {
                if (err) {
                    node.warn('MQTT Error: Subscribe to "' + node.getBaseTopic()+'/accessories/#');
                    node.emit('onConnectError', err);
                } else {
                    node.log('MQTT Subscribed to: "' + node.getBaseTopic()+'/accessories/#');
                }
            })
        }

        unsubscribeMQTT() {
            var node = this;
            node.log('MQTT Unsubscribe from mqtt topic: ' + node.topic);
            node.mqtt.unsubscribe(node.topic, function (err) {});
            node.devices_values = [];
        }

        getToken() {
            var node = this;

            return new Promise(function (resolve, reject) {
                var authUrl = "http://" + node.config.host + ":" +node.spruthub_port + "/api/server/login/"+encodeURIComponent(node.config.email);
                var formData = node.config.password;

                request({
                    headers: {
                        'Content-Length': formData.length,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    uri: authUrl,
                    body: formData,
                    method: 'POST'
                }, function (err, res, body) {
                    if (err) {
                        reject({errorMessage:err});
                    } else if (res.statusCode != 200) {
                        reject({errorMessage:res.statusCode+" "+res.statusMessage+": "+body, statusCode:res.statusCode, statusMessage: res.statusMessage, body:body});
                    } else {
                        if ('set-cookie' in res.headers) {
                            var rawCookie = res.headers['set-cookie'];
                            var regex = /token=([^;]*);/;
                            node.spruthub_token = regex.exec(rawCookie)[1];
                            if (node.spruthub_token) {
                                resolve(node.spruthub_token);
                            } else {
                                reject({errorMessage:"Token not found"});
                            }
                        } else {
                            reject({errorMessage:"Cookie was not set"});
                        }
                    }
                });
            });
        }

        async getAccessories() {
            var node = this;

            var data = await node.getApiCall('/api/homekit/json').catch(error=>{
                node.warn(error);
                return (error);
            });
            if (SprutHubHelper.isJson(data)) {
                node.accessories = JSON.parse(data);
                node.saveCurrentValues(node.accessories);
                return node.accessories;
            }
        }

        async getServiceTypes() {
            var node = this;

            var data = await node.getApiCall('/api/types/service').catch(error=>{
                node.warn(error);
                return (error);
            });
            if (SprutHubHelper.isJson(data)) {
                return node.service_types = JSON.parse(data);
            }
        }

        getApiCall(path) {
            var node = this;
            return new Promise(function (resolve, reject) {
                var url = "http://" + node.config.host + ":" +node.spruthub_port + path;

                request({
                    headers: {
                        'Cookie': 'token='+node.spruthub_token
                    },
                    uri: url,
                    method: 'GET'
                }, function (err, res, body) {
                    if (err) {
                        reject({errorMessage:err});
                    } else if (res.statusCode != 200) {
                        reject({
                            errorMessage: res.statusCode + " " + res.statusMessage + ": " + body,
                            statusCode: res.statusCode,
                            statusMessage: res.statusMessage,
                            body: body
                        });
                    } else {
                        resolve(body);
                    }
                });
            });
        }

        testMqtt() {
            var node = this;

            return new Promise(function (resolve, reject) {
                var timeout = null;
                var client = node.connectMQTT('test');
                client.on('connect', function () {
                    client.subscribe(node.getBaseTopic() + "/revision", function (err) {
                        if (err) {
                            client.end(true);
                            reject({"errorMessage":err});
                        } else {
                            //end function after timeout, if now response
                            timeout = setTimeout(function () {
                                client.end(true);
                                reject({"errorMessage": "MQTT connect timeout"});
                            }, 3000);
                        }
                    })
                });
                client.on('message', function (topic, message) {
                    if (node.getBaseTopic() + "/revision" == topic) {
                        clearTimeout(timeout);
                        client.end(true);
                        resolve({"revision":message.toString()});
                    }
                });
                client.on('error', function (error) {
                    client.end(true);
                    reject({"errorMessage":error});
                });
            });
        }


        async checkConnection(config) {
            var node = this;
            node.config.host = config.host;
            node.config.email = config.email;
            node.config.password = config.password;
            // node.config.mqtt_username = config.mqtt_username;
            // node.config.mqtt_password = config.mqtt_password;

            var result = {
                "auth":false,
                "accessories_cnt":false,
                "version":false,
                "mqtt":false

            };

            var token = await node.getToken().catch(error=>{
                node.warn(error);
            });
            if (token) {
                result['auth'] = true;
            }

            var accessories = await node.getAccessories().catch(error=>{
                node.warn(error);
            });
            if (accessories) {
                result['accessories_cnt'] = Object.keys(accessories.accessories).length;
            }

            var version = await node.getApiCall('/api/server/version').catch(error=>{
                node.warn(error);
            });
            if (version) {
                result['version'] = version;
            }

            var mqtt = await node.testMqtt().catch(error=>{
                node.warn(error);
            });
            if (mqtt) {
                result['mqtt'] = true;
                result['mqtt_data'] = mqtt;
            }

            return result;
        }


        saveCurrentValues(data) {
            var node = this;

            var values = {};
            var key = null;
            var val = null;
            var characteristic = null;
            for (var i in data.accessories) {
                for (var i2 in data.accessories[i]['services']) {
                    for (var i3 in data.accessories[i]['services'][i2]['characteristics']) {
                        key = data.accessories[i]['aid']+'_'+data.accessories[i]['services'][i2]['iid'];
                        characteristic = data.accessories[i]['services'][i2]['characteristics'][i3]['type'];
                        val = data.accessories[i]['services'][i2]['characteristics'][i3]['value'];

                        if (!(key in values)) values[key] = {};
                        values[key][characteristic]  = val;
                    }
                }
            }

            node.current_values = values;
        }

        getDevices() {
            return this.getAccessories();
        }


        getDeviceById(id) {
            var node = this;
            var result = null;
            for (var i in node.devices) {
                if (id == node.devices[i]['ieeeAddr']) {
                    result = node.devices[i];
                    result['lastPayload'] = {};

                    var topic =  node.getBaseTopic()+'/'+(node.devices[i]['friendly_name']?node.devices[i]['friendly_name']:node.devices[i]['ieeeAddr']);
                    if (topic in node.devices_values) {
                        result['lastPayload'] = node.devices_values[topic];
                        result['homekit'] = SprutHubHelper.payload2homekit(node.devices_values[topic], node.devices[i])
                    }
                    break;
                }
            }
            return result;
        }


        getLastStateById(id) {
            var node = this;
            var device = node.getDeviceById(id);
            if (device) {
                return device;
            }
            var group = node.getGroupById(id);
            if (group) {
                return group;
            }
            return {};
        }

        getDeviceByTopic(topic) {
            var node = this;
            var result = null;
            for (var i in node.devices) {
                if (topic == node.getBaseTopic()+'/'+node.devices[i]['friendly_name']
                    || topic == node.getBaseTopic()+'/'+node.devices[i]['ieeeAddr']) {
                    result = node.devices[i];
                    break;
                }
            }
            return result;
        }





        setLogLevel(val) {
            var node = this;
            if (['info', 'debug', 'warn', 'error'].indexOf(val) < 0) val = 'info';
            node.mqtt.publish(node.getBaseTopic() + "/bridge/config/log_level", val);
            node.log('Log Level set to: '+val);
        }



        async onMQTTConnect() {
            var node = this;
            node.connection = true;
            node.log('MQTT Connected');
            node.emit('onMQTTConnect');

            // console.log(SprutHubHelper.convertDevicesData(node.accessories));
            node.subscribeMQTT();
        }

        onMQTTDisconnect(error) {
            var node = this;
            // node.connection = true;
            node.log('MQTT Disconnected');
            console.log(error);

        }

        onMQTTError(error) {
            var node = this;
            // node.connection = true;
            node.log('MQTT Error');
            console.log(error);

        }

        onMQTTOffline() {
            var node = this;
            // node.connection = true;
            node.log('MQTT Offline');
            console.log("MQTT OFFLINE");

        }

        onMQTTEnd() {
            var node = this;
            // node.connection = true;
            node.log('MQTT End');
            // console.log();

        }

        onMQTTReconnect() {
            var node = this;
            // node.connection = true;
            node.log('MQTT Reconnect');
            // console.log();

        }

        onMQTTClose() {
            var node = this;
            // node.connection = true;
            node.log('MQTT Close');
            // console.log(node.connection);

        }

        onMQTTMessage(topic, message) {
            var node = this;
            var messageString = message.toString();

                //isSet
                if (topic.substring(topic.length - 4, topic.length) != '/set') {

                    var parts = topic.split('/')
                    if (parts[2] == 'accessories') {
                        var uid = parts[3]+'_'+parts[4];
                        if (!(uid in node.current_values)) node.current_values[uid] = {};

                        var value = SprutHubHelper.isNumber(messageString)?parseFloat(messageString):messageString;
                        node.current_values[uid][parts[6]] = value;
                        node.emit('onMQTTMessage', {
                            uid: uid
                        });
                    }

                }
            // }
        }

        onClose() {
            var node = this;
            node.unsubscribeMQTT();
            node.mqtt.end();
            node.connection = false;
            node.emit('onClose');
            node.log('MQTT connection closed');
        }
    }

    RED.nodes.registerType('spruthub-server', ServerNode, {});
};

