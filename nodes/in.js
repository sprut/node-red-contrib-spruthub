const SprutHubHelper = require('../lib/SprutHubHelper.js');

module.exports = function(RED) {
    class SprutHubNodeIn {
        constructor(config) {
            RED.nodes.createNode(this, config);

            var node = this;
            node.config = config;
            node.is_subscribed = false;
            node.cleanTimer = null;
            node.server = RED.nodes.getNode(node.config.server);
            node.serviceType = undefined;
            node.config.cid = parseInt(node.config.cid);
// console.log(node.config );
            node.status({}); //clean

            if (typeof(node.config.uid) != 'object' || !(node.config.uid).length) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_accessory"
                });
            } else if (node.server) {
                node.listener_onDisconnected = function() { node.onDisconnected(); }
                node.server.on('onDisconnected', node.listener_onDisconnected);

                node.listener_onConnected = function() { node.onConnected(); }
                node.server.on('onConnected', node.listener_onConnected);

                node.listener_onMessage = function(data) { node.onMessage(data); }
                node.server.on('onMessage', node.listener_onMessage);

                node.on('close', () => this.sendStatusError());

                node.onConnected();
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

        _sendStatusMultiple(changed = null) {
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
                            if (meta.service.characteristics[i2]['cId'] === parseInt(cid)) {
                                p[meta.service.characteristics[i2]['type']] = node.server.current_values[uid][cid];
                                break;
                            }
                        }
                    }
                    payload[uid]['payload'] = p;

                    math.push(payload[uid]['payload']);
                }
            }

            node.send({
                payload: payload,
                changed: changed,
                math:SprutHubHelper.formatMath(math)
            });

            node.status({
                fill: "green",
                shape: "dot",
                text: changed?changed.value:"node-red-contrib-spruthub/server:status.received"
            });

            clearTimeout(node.cleanTimer);
            node.cleanTimer = setTimeout(function () {
                node.status({
                    fill: "grey",
                    shape: "ring",
                    text: (changed?changed.value:'')+(' '+SprutHubHelper.statusUpdatedAt())
                });
            }, 3000);
        }

        _sendStatusSingle(topic = null, changed = null) {
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

                        if (!topic) topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+cid;

                        var unit = "unit" in meta?meta['unit']:'';
                        if (unit) unit = RED._("node-red-contrib-spruthub/server:unit."+unit, ""); //add translation

                        node.send({
                            topic: topic,
                            elementId: SprutHubHelper.generateElementId(topic),
                            payload: payload,
                            meta: meta,
                            changed: changed
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
                                text: payload + (unit?' '+unit:'')+' '+SprutHubHelper.statusUpdatedAt()
                            });
                        }, 3000);
                    }

                } else { //output all
                    //format payload
                    var p = {};
                    for (var cid in node.server.current_values[uid]) {
                        for (var i2 in meta.service.characteristics) {
                            if (meta.service.characteristics[i2]['cId'] === parseInt(cid)) {
                                p[meta.service.characteristics[i2]['type']] = node.server.current_values[uid][cid];
                                break;
                            }
                        }
                    }
                    var payload = p;//node.server.current_values[uid];
                    // payload[uid]['payload'] = p;

                    if (!topic) topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/#';

                    node.send({
                        topic: topic,
                        elementId: SprutHubHelper.generateElementId(topic),
                        payload: payload,
                        meta: meta,
                        changed: changed
                    });

                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "node-red-contrib-spruthub/server:status.received"
                    });

                    clearTimeout(node.cleanTimer);
                    node.cleanTimer = setTimeout(function () {
                        node.status({
                            fill: "grey",
                            shape: "ring",
                            text: SprutHubHelper.statusUpdatedAt()
                        });
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

        sendStatus(topic = null, changed = null) {
            if (!this.config.uid) return;

            if (this.config.enableMultiple) {
                this._sendStatusMultiple(changed);
            } else {
                this._sendStatusSingle(topic, changed);
            }
        }

        onMessage(data) {
            var node = this;
            if (node.config.uid && (node.config.uid).includes(data.service_id)) {
                if (!node.config.cid || (node.config.cid && parseInt(data.cid) === node.config.cid)) {
                    node.sendStatus(data.topic, data);
                }
            }
        }

        onConnected() {
            let node = this;
            if (node.server.connection && node.config.outputAtStartup) {
                node.sendStatus();
            }
        }

        onDisconnected() {
            var node = this;

            if (node.listener_onConnected) {
                node.server.removeListener("onConnected", node.listener_onConnected);
            }
            if (node.listener_onDisconnected) {
                node.server.removeListener("onDisconnected", node.listener_onDisconnected);
            }
            if (node.listener_onMessage) {
                node.server.removeListener("onMessage", node.listener_onMessage);
            }

            node.sendStatusError();
        }

        sendStatusError(status = null) {
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



