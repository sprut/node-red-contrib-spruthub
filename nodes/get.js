const SprutHubHelper = require('../lib/SprutHubHelper.js');

module.exports = function(RED) {
    class SprutHubNodeGet {
        constructor(config) {

            RED.nodes.createNode(this, config);

            var node = this;
            node.config = config;
            node.cleanTimer = null;
            node.server = RED.nodes.getNode(node.config.server);
            node.serviceType = undefined;
            node.message_in = null;
            node.config.cid = node.config.cid==='0'?'':node.config.cid;
            node.config.uid =  (node.config.uid).filter(function (el) {
                return el;
            });
            node.uids = node.config.uid;
            node.last_successful_status = {};

            if (node.server)  {

                node.listener_onConnected = function() { node.onConnected(); }
                node.server.on('onConnected', node.listener_onConnected);

                node.on('close', () => node.onClose());

                node.onConnected();

                node.on('input', function(message_in) {
                    if (node.server.connection) {
                        node.message_in = message_in;

                        //overwrite with elementId
                        // if ((!node.config.uid || !(node.config.uid).length) && "elementId" in message_in) {
                        //     // message_in.topic = node.server.getTopicByElementId(message_in.elementId);
                        // }

                        //overwrite with topic
                        if ((!node.config.uid || !(node.config.uid).length) && "topic" in message_in) {
                            node.uids = [];
                            if (typeof (message_in.topic) == 'string') {
                                var parsedTopic = SprutHubHelper.parseTopic(message_in.topic);
                                (node.uids).push(parsedTopic['uid']);

                                this.config.enableMultiple = false;
                            } else if (typeof (message_in.topic) == 'object') {
                                for (var i in message_in.topic) {
                                    var parsedTopic = SprutHubHelper.parseTopic(message_in.topic[i]);
                                    (node.uids).push(parsedTopic['uid']);
                                }

                                if ((node.uids).length > 1) this.config.enableMultiple = true;
                            }
                        }

                        node.sendStatus();
                    } else {
                        node.sendStatusError();
                    }
                });
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_server"
                });
            }
        }

        _sendStatusMultiple() {
            let node = this;
            let uidArr = node.uids;

            let payload  = {};
            let math = [];
            for (let i in uidArr) {
                let uid = uidArr[i];

                if (uid in node.server.current_values) {
                    var meta = node.getServiceType(uid);
                    payload[uid] = {};
                    payload[uid]['topic'] = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/#';
                    payload[uid]['elementId'] = SprutHubHelper.generateElementId(payload[uid]['topic']);
                    payload[uid]['meta'] = meta;

                    //format payload
                    let p = {};
                    for (let cid in node.server.current_values[uid]) {
                        for (let i2 in meta.service.characteristics) {
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
                payload_in: node.message_in.payload,
                message_in: node.message_in,
                math:SprutHubHelper.formatMath(math)
            });

            node.setSuccessfulStatus({
                fill: "green",
                shape: "dot",
                text: "node-red-contrib-spruthub/server:status.received"
            });
            clearTimeout(node.cleanTimer);
            node.cleanTimer = setTimeout(function () {
                node.setSuccessfulStatus({
                    fill: "grey",
                    shape: "ring",
                    text: SprutHubHelper.statusUpdatedAt()
                });
            }, 3000);
        }

        _sendStatusSingle() {
            let node = this;
            let uid = node.uids[0];
            var cid = node.config.cid?node.config.cid:false;

            if (uid in node.server.current_values) {
                let meta = node.getServiceType(uid);
                if (!meta) return;

                if (cid) { //output specified characteristic
                    if (cid in node.server.current_values[uid]) {

                        var payload = node.server.current_values[uid][cid];
                        payload = SprutHubHelper.isNumber(payload)?parseFloat(payload):payload;
                        var topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+cid;

                        var unit = "unit" in meta?meta['unit']:'';
                        if (unit) unit = RED._("node-red-contrib-spruthub/server:unit."+unit, ""); //add translation

                        var text = payload + (unit?' '+unit:'');

                        clearTimeout(node.cleanTimer);
                        node.cleanTimer = setTimeout(function () {
                            node.setSuccessfulStatus({
                                fill: "grey",
                                shape: "ring",
                                text: text+' '+SprutHubHelper.statusUpdatedAt()
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

                    var topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/#';
                    var text =  "node-red-contrib-spruthub/server:status.received";

                    clearTimeout(node.cleanTimer);
                    node.cleanTimer = setTimeout(function () {
                        node.setSuccessfulStatus({
                            fill: "grey",
                            shape: "ring",
                            text: SprutHubHelper.statusUpdatedAt()
                        });
                    }, 3000);
                }

                node.send({
                    topic: topic,
                    elementId: SprutHubHelper.generateElementId(topic),
                    payload: payload,
                    message_in: node.message_in,
                    payload_in: node.message_in.payload,
                    meta: meta
                });

                node.setSuccessfulStatus({
                    fill: "green",
                    shape: "dot",
                    text: text
                });

            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_value"
                });
            }
        }

        sendStatus() {
            if (!this.uids || !(this.uids).length) return;

            if (this.config.enableMultiple) {
                this._sendStatusMultiple();
            } else {
                this._sendStatusSingle();
            }
        }

        setSuccessfulStatus(obj) {
            let node = this;
            node.status(obj);
            node.last_successful_status = obj;
        }

        getServiceType(uid) {
            let node = this;
            if (node.serviceType !== undefined) {
                return node.serviceType;
            } else {
                return node.server.getServiceType(uid, node.config.cid);
            }
        }

        onConnected() {
            let node = this;
            if (node.server.connection) {
                node.status(node.last_successful_status);
            } else {
                node.sendStatusError();
            }
        }

        onClose() {
            let node = this;

            if (node.listener_onDisconnected) {
                node.server.removeListener("onDisconnected", node.listener_onDisconnected);
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
    RED.nodes.registerType('spruthub-get', SprutHubNodeGet);
};




