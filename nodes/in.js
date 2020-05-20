const SprutHubHelper = require('../lib/SprutHubHelper.js');

var mqtt = require('mqtt');

module.exports = function(RED) {
    class SprutHubNodeIn {
        constructor(config) {
            RED.nodes.createNode(this, config);

            var node = this;
            node.config = config;
            node.firstMsg = true;
            node.is_subscribed = false;
            node.cleanTimer = null;
            node.server = RED.nodes.getNode(node.config.server);
            node.serviceType = undefined;

            node.status({}); //clean

            // console.log(node.config);

            if (typeof(node.config.uid) != 'object' || !(node.config.uid).length) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_accessory"
                });
            } else if (node.server) {
                node.listener_onMQTTConnect = function(data) { node.onMQTTConnect(); }
                node.server.on('onMQTTConnect', node.listener_onMQTTConnect);

                node.listener_onConnectError = function(data) { node.onConnectError(); }
                node.server.on('onConnectError', node.listener_onConnectError);

                node.listener_onMQTTMessage = function(data) { node.onMQTTMessage(data); }
                node.server.on('onMQTTMessage', node.listener_onMQTTMessage);

                node.listener_onMQTTBridgeState = function(data) { node.onMQTTBridgeState(data); }
                node.server.on('onMQTTBridgeState', node.listener_onMQTTBridgeState);

                node.on('close', () => this.onMQTTClose());

                if (typeof(node.server.mqtt) === 'object') {
                    node.onMQTTConnect();
                }
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_server"
                });
            }
        }

        onConnectError(status = null) {
            var node = this;
            // node.status({
            //     fill: "red",
            //     shape: "dot",
            //     text: "node-red-contrib-spruthub/server:status.no_connection"
            // });
        }

        onMQTTClose() {
            var node = this;

            //remove listeners
            if (node.listener_onMQTTConnect) {
                node.server.removeListener('onMQTTConnect', node.listener_onMQTTConnect);
            }
            if (node.listener_onConnectError) {
                node.server.removeListener('onConnectError', node.listener_onConnectError);
            }
            if (node.listener_onMQTTMessage) {
                node.server.removeListener("onMQTTMessage", node.listener_onMQTTMessage);
            }
            if (node.listener_onMQTTBridgeState) {
                node.server.removeListener("onMQTTBridgeState", node.listener_onMQTTBridgeState);
            }

            node.onConnectError();
        }

        getServiceType(uid) {
            var node = this;
            if (node.serviceType !== undefined) return node.serviceType;


            var uidRaw = uid.split('_');
            var aid = uidRaw[0];
            var sid = uidRaw[1];
            var cid = node.config.cid!='0'?node.config.cid:false;


            var res = {};
            loop1:
            for (var i in node.server.accessories.accessories) {
                if (node.server.accessories.accessories[i]['aid'] == aid) {
                    loop2:
                    for (var i2 in node.server.accessories.accessories[i]['services']) {
                        if (node.server.accessories.accessories[i]['services'][i2]['iid'] == sid) {
                            if (cid) {
                                for (var i3 in node.server.accessories.accessories[i]['services'][i2]['characteristics']) {
                                    if (node.server.accessories.accessories[i]['services'][i2]['characteristics'][i3]['type'] == cid) {
                                        res['service'] = node.server.accessories.accessories[i]['services'][i2];
                                        res['characteristic'] = node.server.accessories.accessories[i]['services'][i2]['characteristics'][i3];
                                        break loop1;
                                    }
                                }
                            } else {
                                res['service'] = node.server.accessories.accessories[i]['services'][i2];
                                break loop1;
                            }
                        }
                    }
                }
            }

            if (!cid) {
                node.serviceType = res;
                return node.serviceType;
            }



            var serviceType = {};
            loop1:
            for (var i in node.server.service_types) {
                if (res['service'] == node.server.service_types[i]['name']) {
                    loop2:
                    for (var i2 in node.server.service_types[i]['required']) {
                        if (node.server.service_types[i]['required'][i2]['name'] == res['characteristic']) {
                            serviceType = node.server.service_types[i]['required'][i2];
                            break loop1;
                        }
                        if (node.server.service_types[i]['optional'][i2]['name'] == res['characteristic']) {
                            serviceType = node.server.service_types[i]['optional'][i2];
                            break loop1;
                        }
                    }

                }
            }
            serviceType['service'] = res['service'];
            serviceType['characteristic'] = res['characteristic'];
            node.serviceType = serviceType;


            return node.serviceType;
        }

        onMQTTConnect() {
            this.sendStatus();
        }

        _sendStatusMultiple() {
            var node = this;
            var uidArr = node.config.uid;

            var payload  = [];
            for (var i in uidArr) {
                var uid = uidArr[i];

                if (uid in node.server.current_values) {
                    payload.push(node.server.current_values[uid]);
                }
            }

            if (node.firstMsg && !node.config.outputAtStartup) {
                node.firstMsg = false;
                return;
            }

            node.send({
                payload: payload,
                math:SprutHubHelper.formatMath(payload)
            });

            node.status({
                fill: "green",
                shape: "dot",
                text: "node-red-contrib-spruthub/server:status.received"
            });

            clearTimeout(node.cleanTimer);
            node.cleanTimer = setTimeout(function () {
                node.status({});
            }, 3000);
        }

        _sendStatusSingle() {
            var node = this;
            var uid = node.config.uid[0];
            var cid = node.config.cid!='0'?node.config.cid:false;

            if (uid in node.server.current_values) {
                var meta = node.getServiceType(uid);

                if (cid) { //output specified characteristic
                    if (cid in node.server.current_values[uid]) {

                        var payload = node.server.current_values[uid][cid];
                        payload = SprutHubHelper.isNumber(payload)?parseFloat(payload):payload;
                        var topic = node.server.getBaseTopic()+'/accessories/'+uid+'/'+meta['service']['type']+'/'+meta['characteristic']['type'];

                        var unit = meta && "characteristic" in meta && "unit" in meta['characteristic']?meta['characteristic']['unit']:'';
                        if (unit) unit = RED._("node-red-contrib-spruthub/server:unit."+unit, ""); //add translation


                        if (node.firstMsg && !node.config.outputAtStartup) {
                            node.firstMsg = false;

                            node.status({
                                fill: "green",
                                shape: "ring",
                                text: payload + (unit?' '+unit:'')
                            });
                            return;
                        }
                        node.send({
                            topic: topic,
                            payload: payload,
                            meta: meta
                        });

                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: payload + (unit?' '+unit:'')
                        });
                        clearTimeout(node.cleanTimer);
                        node.cleanTimer = setTimeout(function () {
                            node.status({
                                fill: "green",
                                shape: "ring",
                                text: payload + (unit?' '+unit:'')
                            });
                        }, 3000);
                    }

                } else { //output all
                    var payload = node.server.current_values[uid];
                    var topic = node.server.getBaseTopic()+'/accessories/'+uid+'/'+meta['service']['type']+'/#';

                    if (node.firstMsg && !node.config.outputAtStartup) {
                        node.firstMsg = false;
                        return;
                    }

                    node.send({
                        topic: topic,
                        payload: payload,
                        meta: meta
                    });

                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "node-red-contrib-spruthub/server:status.received"
                    });

                    clearTimeout(node.cleanTimer);
                    node.cleanTimer = setTimeout(function () {
                        node.status({});
                    }, 3000);
                }

            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_value"
                });
            }
        }

        sendStatus() {
            if (!this.config.uid) return;

            if (this.config.enableMultiple) {
                this._sendStatusMultiple();
            } else {
                this._sendStatusSingle();
            }
        }

        onMQTTMessage(data) {
            var node = this;

            if (node.config.uid && (node.config.uid).includes(data.uid)) {
                node.sendStatus();
            }
        }

        onMQTTBridgeState(data) {
            var node = this;

            if (data.payload) {
                node.status({});
            } else {
                this.onConnectError();
            }
        }


    }
    RED.nodes.registerType('spruthub-in', SprutHubNodeIn);
};



