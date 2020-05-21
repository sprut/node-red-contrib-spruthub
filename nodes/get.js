const SprutHubHelper = require('../lib/SprutHubHelper.js');
var mqtt = require('mqtt');

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


            if (typeof(node.config.uid) != 'object' || !(node.config.uid).length) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "node-red-contrib-spruthub/server:status.no_accessory"
                });
            } else if (node.server)  {
                node.on('input', function (message_in) {
                    node.message_in = message_in;
                    node.sendStatus();
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
            var node = this;
            var uidArr = node.config.uid;

            var payload  = [];
            for (var i in uidArr) {
                var uid = uidArr[i];

                if (uid in node.server.current_values) {
                    payload.push(node.server.current_values[uid]);
                }
            }

            node.send({
                payload: payload,
                payload_in: node.message_in,
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
            var cid = node.config.cid?node.config.cid:false;

            if (uid in node.server.current_values) {
                var meta = node.getServiceType(uid);
                if (!meta) return;

                if (cid) { //output specified characteristic
                    if (cid in node.server.current_values[uid]) {

                        var payload = node.server.current_values[uid][cid];
                        payload = SprutHubHelper.isNumber(payload)?parseFloat(payload):payload;
                        var topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+meta['service']['type']+'/'+meta['characteristic']['type'];

                        var unit = meta && "characteristic" in meta && "unit" in meta['characteristic']?meta['characteristic']['unit']:'';
                        if (unit) unit = RED._("node-red-contrib-spruthub/server:unit."+unit, ""); //add translation

                        var text = payload + (unit?' '+unit:'');

                        clearTimeout(node.cleanTimer);
                        node.cleanTimer = setTimeout(function () {
                            node.status({text: text});
                        }, 3000);

                    }

                } else { //output all
                    var payload = node.server.current_values[uid];
                    var topic = node.server.getBaseTopic()+'/accessories/'+uid.split('_').join('/')+'/'+meta['service']['type']+'/#';
                    var text =  "node-red-contrib-spruthub/server:status.received";

                    clearTimeout(node.cleanTimer);
                    node.cleanTimer = setTimeout(function () {
                        node.status({});
                    }, 3000);
                }

                node.send({
                    topic: topic,
                    payload: payload,
                    payload_in: node.message_in,
                    meta: meta
                });

                node.status({
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
            if (!this.config.uid) return;

            if (this.config.enableMultiple) {
                this._sendStatusMultiple();
            } else {
                this._sendStatusSingle();
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
    }
    RED.nodes.registerType('spruthub-get', SprutHubNodeGet);
};




