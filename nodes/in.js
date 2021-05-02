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
            node.config.cid = parseInt(node.config.cid);

            node.status({}); //clean


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

                node.listener_onSpruthubRestart = function(data) { node.onSpruthubRestart(); }
                node.server.on('onSpruthubRestart', node.listener_onSpruthubRestart);

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

        getCidByType(service_id, type) {
            var node = this;
            var meta = node.getServiceType(service_id);

            var cid = 0;

            if (type) {
                for (var i in meta.service.characteristics) {
                    if (meta.service.characteristics[i]['type'] === type) {
                        cid = meta.service.characteristics[i]['iid'];
                        break;
                    }
                }
            }

            return parseInt(cid);
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
                    payload[uid]['meta'] = meta;
                    payload[uid]['topic'] = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/#';
                    payload[uid]['elementId'] = SprutHubHelper.generateElementId(payload[uid]['topic']);
                    payload[uid]['meta'] = meta;

                    //format payload
                    var p = {};
                    for (var cid in node.server.current_values[uid]) {
                        for (var i2 in meta.service.characteristics) {
                            if (meta.service.characteristics[i2]['iid'] === parseInt(cid)) {
                                p[meta.service.characteristics[i2]['type']] = node.server.current_values[uid][cid];
                                break;
                            }
                        }
                    }
                    payload[uid]['payload'] = p;

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

        _sendStatusSingle(topic = null) {
            var node = this;
            var uid = node.config.uid[0];
            var cid = node.config.cid

            // console.log(node.server.current_values);

            if (uid in node.server.current_values) {
                var meta = node.getServiceType(uid);
                if (!meta || !"service" in meta || !"characteristic" in meta
                    || !meta.service || !"type" in meta.service) return;

                if (cid) { //output specified characteristic
                    if (cid in node.server.current_values[uid]) {

                        var payload = node.server.current_values[uid][cid];

                        // console.log(payload);

                        if (!topic) topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+cid;

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
                                fill: "grey",
                                shape: "ring",
                                text: payload + (unit?' '+unit:'')
                            });
                        }, 3000);
                    }

                } else { //output all
                    //format payload
                    var p = {};
                    for (var cid in node.server.current_values[uid]) {
                        for (var i2 in meta.service.characteristics) {
                            if (meta.service.characteristics[i2]['iid'] === parseInt(cid)) {
                                p[meta.service.characteristics[i2]['type']] = node.server.current_values[uid][cid];
                                break;
                            }
                        }
                    }
                    var payload = p;//node.server.current_values[uid];
                    // payload[uid]['payload'] = p;

                    if (!topic) topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/#';

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

        sendStatus(topic = null) {
            if (!this.config.uid) return;

            if (this.config.enableMultiple) {
                this._sendStatusMultiple();
            } else {
                this._sendStatusSingle(topic);
            }
        }

        onMQTTConnect() {
            this.firstMsg = true;
            this.sendStatus();
        }

        onMQTTMessage(data) {
            var node = this;
            if (node.config.uid && (node.config.uid).includes(data.service_id)) {
                if (!node.config.cid || (node.config.cid && parseInt(data.cid) === node.config.cid)) {
                    node.sendStatus(data.topic);
                }
            }
        }

        onSpruthubRestart() {
            this.firstMsg = true;
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
            if (node.listener_onSpruthubRestart) {
                node.server.removeListener("onSpruthubRestart", node.listener_onSpruthubRestart);
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

            this.firstMsg = true;
        }

    }
    RED.nodes.registerType('spruthub-in', SprutHubNodeIn);
};



