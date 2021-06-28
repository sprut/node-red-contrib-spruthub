const SprutHubHelper = require('../lib/SprutHubHelper.js');
var mqtt = require('mqtt');

module.exports = function(RED) {
    class SprutHubNodeOut {
        constructor(config) {
            RED.nodes.createNode(this, config);

            var node = this;
            node.config = config;
            node.cleanTimer = null;
            node.server = RED.nodes.getNode(node.config.server);
            node.last_change = null;
            node.serviceType = undefined;
            node.config.cid = node.config.cid==='0'?'':node.config.cid;
            node.uids = node.config.uid;

            if (node.server)  {
                node.on('input', function (message) {
                    node.processInput(message);
                });
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_server"
                });
            }
        }

        processInput(message) {
            var node = this;
            clearTimeout(node.cleanTimer);

            //overwrite with topic
            if ((!node.config.uid || !(node.config.uid).length) && "topic" in message) {
                node.uids = [];
                if (typeof(message.topic) == 'string' ) {
                    var parsedTopic = SprutHubHelper.parseTopic(message.topic);
                    (node.uids).push(parsedTopic['uid']);

                    this.config.enableMultiple = false;
                } else if (typeof(message.topic) == 'object') {
                    for (var i in message.topic) {
                        var parsedTopic = SprutHubHelper.parseTopic(message.topic[i]);
                        (node.uids).push(parsedTopic['uid']);
                    }

                    if ((node.uids).length > 1) this.config.enableMultiple = true;
                }
            }

            var payload;
            switch (node.config.payloadType) {
                case 'flow':
                case 'global': {
                    RED.util.evaluateNodeProperty(node.config.payload, node.config.payloadType, this, message, function (error, result) {
                        if (error) {
                            node.error(error, message);
                        } else {
                            payload = result;
                        }
                    });
                    break;
                }
                case 'num': {
                    payload = parseInt(node.config.payload);
                    break;
                }

                case 'str': {
                    payload = node.config.payload;
                    break;
                }

                case 'bool': {
                    payload = node.config.payload?"true":"false";
                    break;
                }

                case 'json': {
                    if (SprutHubHelper.isJson(node.config.payload)) {
                        payload = JSON.parse(node.config.payload);
                    } else {
                        node.warn('Incorrect payload. Waiting for valid JSON');
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "node-red-contrib-spruthub/out:status.no_payload"
                        });
                        node.cleanTimer = setTimeout(function () {
                            node.status({}); //clean
                        }, 3000);
                    }
                    break;
                }

                case 'sh_payload':
                    payload = node.config.payload;
                    break;

                case 'msg':
                default: {
                    payload = message[node.config.payload];
                    break;
                }
            }


            //validate payload
            if (payload === null || payload === undefined) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/out:status.no_payload"
                });
                return false;
            }

            // var rbe = "rbe" in node.config && node.config.rbe;

            for (var i in node.uids) {
                var uid = node.uids[i];

                var meta = null;
                var cid = null;
                var topic = '';
                if (typeof(payload) == 'object') {
                    var sentCnt = 0;
                    for (var characteristicName in payload) {
                        meta = node.getServiceType(uid);
                        cid = meta['accessory'][meta['service']['type']][characteristicName]['iid'];

                        var lastValue = node.server.current_values[uid][cid];
                        if (node.config.payloadType === 'sh_payload' && payload === 'toggle') {
                            payload = lastValue?0:1;
                        }

                        meta = node.getServiceType(uid, cid);

                        // console.log(meta['accessory'][ meta['service']['type']][cid]['iid']);
                        if (meta['service'] !== undefined && meta['characteristic'] !== undefined) {
                            topic = node.server.getBaseTopic() + '/accessories/' + uid.split('_').join('/') + '/' + cid + '/set';
                            node.log('Published to mqtt topic: ' + topic + ' : ' + payload[characteristicName] + "");
                            node.server.mqtt.publish(topic, payload[characteristicName] + "");
                            node.last_change = new Date().getTime();
                            sentCnt++;
                        } else {
                            node.warn('Check you payload. No such characteristic: '+cid);
                        }
                    }
                    if (!sentCnt) {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "node-red-contrib-spruthub/server:status.no_characteristic"
                        });
                        return false;
                    }
                } else {
                    if (!node.config.cid) {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "node-red-contrib-spruthub/server:status.no_characteristic"
                        });
                        return false;
                    }

                    var lastValue = node.server.current_values[uid][node.config.cid];
                    if (node.config.payloadType === 'sh_payload' && payload === 'toggle') {
                        payload = lastValue?0:1;
                    }

                    meta = node.getServiceType(uid, node.config.cid);
                    topic = node.server.getBaseTopic() + '/accessories/' + uid.split('_').join('/') + '/' + node.config.cid+ '/set';
                    node.log('Published to mqtt topic: ' + topic + ' : ' + payload+"");
                    node.server.mqtt.publish(topic, payload+"");
                    node.last_change = new Date().getTime();
                }
            }

            var timeText = ' [' + new Date(node.last_change).toLocaleDateString('ru-RU') + ' ' + new Date(node.last_change).toLocaleTimeString('ru-RU') + ']';

            node.status({
                fill: "green",
                shape: "dot",
                text: (typeof(payload) == 'object'?JSON.stringify(payload):payload) + timeText
            });

            node.cleanTimer = setTimeout(function() {
                node.status({
                    fill: "grey",
                    shape: "ring",
                    text: (typeof(payload) == 'object'?JSON.stringify(payload):payload) + timeText
                });
            }, 3000);
        }


        getServiceType(uid, cid) {
            return this.server.getServiceType(uid, cid);
        }
    }


    RED.nodes.registerType('spruthub-out', SprutHubNodeOut);
};






