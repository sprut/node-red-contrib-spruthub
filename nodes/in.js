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
            node.config.cid = node.config.cid==='0'?'':node.config.cid;

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

        getServiceType(uid) {
            var node = this;
            if (node.serviceType !== undefined) {
                return node.serviceType;
            } else {
                return node.server.getServiceType(uid, node.config.cid);
            }
        }

        _sendStatusMultiple() {
            var node = this;
            var uidArr = node.config.uid;

            var payload  = {};
            var math = [];
            for (var i in uidArr) {
                var uid = uidArr[i];

                if (uid in node.server.current_values) {
                    var meta = node.getServiceType(uid);
                    payload[uid] = {};
                    payload[uid]['payload'] = node.server.current_values[uid];
                    payload[uid]['topic'] = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+meta['service']['type']+'/#';
                    payload[uid]['elementId'] = SprutHubHelper.generateElementId(payload[uid]['topic']);
                    payload[uid]['meta'] = meta;

                    math.push(payload[uid]['payload']);
                }
            }

            if (node.firstMsg && !node.config.outputAtStartup) {
                node.firstMsg = false;
                return;
            }

            node.send({
                payload: payload,
                math:SprutHubHelper.formatMath(math)
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
            var cid = node.config.cid?node.config.cid:false;


            if (uid in node.server.current_values) {
                var meta = node.getServiceType(uid);
                if (!meta || !"service" in meta || !"characteristic" in meta
                    || !meta.service || !"type" in meta.service) return;

                if (cid) { //output specified characteristic
                    if (cid in node.server.current_values[uid]) {

                        var payload = node.server.current_values[uid][cid];
                        var topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+meta['service']['type']+'/'+meta['characteristic']['type'];

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
                            elementId: SprutHubHelper.generateElementId(topic),
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
                    var topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+meta['service']['type']+'/#';

                    if (node.firstMsg && !node.config.outputAtStartup) {
                        node.firstMsg = false;
                        return;
                    }

                    node.send({
                        topic: topic,
                        elementId: SprutHubHelper.generateElementId(topic),
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

        onMQTTConnect() {
            this.sendStatus();
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

        onMQTTClose() {
            var node = this;

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

        onConnectError(status = null) {
            var node = this;
            node.status({
                fill: "red",
                shape: "dot",
                text: "node-red-contrib-spruthub/server:status.no_connection"
            });
        }

    }
    RED.nodes.registerType('spruthub-in', SprutHubNodeIn);
};



