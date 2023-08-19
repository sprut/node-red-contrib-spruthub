const SprutHubHelper = require('../lib/SprutHubHelper.js');


module.exports = function(RED) {
    class SprutHubNodeOut {
        constructor(config) {
            RED.nodes.createNode(this, config);

            let node = this;
            node.config = config;
            node.cleanTimer = null;
            node.server = RED.nodes.getNode(node.config.server);
            node.last_change = null;
            node.serviceType = undefined;
            node.config.cid = node.config.cid==='0'?'':node.config.cid;
            node.config.uid =  (node.config.uid).filter(function (el) {
                return el;
            });
            node.uids = node.config.uid;
            node.last_successful_status = {};

            if (node.server)  {
                node.listener_onConnected = function() { node.onConnected(); }
                node.server.on('onConnected', node.listener_onConnected);

                node.onConnected();

                node.on('close', () => node.onClose());

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
            let node = this;
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

            let payload;
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
                    payload = node.config.payload == 'false' || !node.config.payload ? false : true;
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

            let rbe = "rbe" in node.config && node.config.rbe;

            let dataToSend = [];
            for (var i in node.uids) {
                let uid = node.uids[i];
                let cid = null;
                let meta = null;
                let meta2 = null;

                if (typeof (payload) == 'object') {
                    for (var characteristicName in payload) {
                        meta = node.getServiceType(uid);
                        if (characteristicName in meta['accessory'][meta['service']['type']]) {
                            cid = meta['accessory'][meta['service']['type']][characteristicName]['cId'];
                            meta2 = node.getServiceType(uid, cid);

                            dataToSend.push({
                                'aId': parseInt(uid.split('_')[0]),
                                'sId': parseInt(uid.split('_')[1]),
                                'cId': parseInt(cid),
                                'new_value': payload[characteristicName],
                                'last_value': node.server.current_values[uid][cid],
                                'value_type': Object.keys(meta2.characteristic.value)[0]
                            });
                        } else {
                            node.warn('skipped unknown characteristic:' + characteristicName)
                        }
                    }
                } else {
                    meta = node.getServiceType(uid, node.config.cid);
                    dataToSend.push({
                        'aId': parseInt(uid.split('_')[0]),
                        'sId': parseInt(uid.split('_')[1]),
                        'cId': parseInt(node.config.cid),
                        'new_value': payload,
                        'last_value': node.server.current_values[uid][node.config.cid],
                        'value_type': Object.keys(meta.characteristic.value)[0]
                    });
                }
            }
            for (var i in dataToSend) {
                let row = dataToSend[i];

                if (rbe && row['last_value'] === row['new_value']) {
                    node.log('Skipped RBE value');
                    continue;
                }
                if (node.config.payloadType === 'sh_payload' && row['new_value'] === 'toggle') {
                    row['new_value'] = row['last_value'] ? false : true;
                }

                //convert var type
                row['value'] = row['new_value'];
                let sendValue = {};
                sendValue[row['value_type']] = row['new_value'];

                let data = {'aId':row['aId'], 'cId':row['cId'], 'value':  sendValue};
                // let data = {characteristic: {'aId':row['aId'], 'cId':row['cId'], 'value':  sendValue}};
                node.log('Published to jRPC: characteristic.update : ' + JSON.stringify(data));

                node.server.ws.call('', {characteristic:{update:data}}, 1000).then(function(result) {
                    node.setSuccessfulStatus({
                        fill: "green",
                        shape: "dot",
                        text: (typeof(row['new_value']) == 'object'?JSON.stringify(row['new_value']):row['new_value'])
                    });

                    node.last_change = new Date().getTime();
                    var timeText = SprutHubHelper.statusUpdatedAt(node.last_change);
                    node.cleanTimer = setTimeout(function() {
                        node.setSuccessfulStatus({
                            fill: "grey",
                            shape: "ring",
                            text: (typeof(row['new_value']) == 'object'?JSON.stringify(row['new_value']):row['new_value']) + timeText
                        });
                    }, 3000);
                }).catch(function(error) {
                    node.sendStatusError();
                    node.error(error);
                })
            }
        }

        setSuccessfulStatus(obj) {
            let node = this;
            node.status(obj);
            node.last_successful_status = obj;
        }

        onConnected() {
            let node = this;
            if (node.server.connection) {
                node.status(node.last_successful_status);
            } else {
                node.sendStatusError();
            }
        }


        getServiceType(uid, cid) {
            return this.server.getServiceType(uid, cid);
        }

        onClose() {
            let node = this;

            if (node.listener_onConnected) {
                node.server.removeListener("onConnected", node.listener_onConnected);
            }

            node.sendStatusError();
        }

        sendStatusError(status = null) {
            let node = this;
            node.status({
                fill: "red",
                shape: "dot",
                text: "node-red-contrib-spruthub/server:status.no_connection"
            });
            setTimeout(function(){
                node.status({});
            }, 3000);
        }
    }

    RED.nodes.registerType('spruthub-out', SprutHubNodeOut);
};






