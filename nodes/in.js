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

            // console.log(node.config);
            node.status({}); //clean

            if (node.server) {
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
                    text: "node-red-contrib-spruthub/in:status.no_server"
                });
            }
        }

        onConnectError(status = null) {
            var node = this;
            // node.status({
            //     fill: "red",
            //     shape: "dot",
            //     text: "node-red-contrib-spruthub/in:status.no_connection"
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

        getServiceType() {
            var node = this;
            if (node.serviceType !== undefined) return node.serviceType;


            var uidRaw = (node.config.uid).split('_');
            var aid = uidRaw[0];
            var sid = uidRaw[1];
            var cid = node.config.cid;

            if (!cid) return null;

            var res = {};
            for (var i in node.server.accessories.accessories) {
                if (node.server.accessories.accessories[i]['aid'] == aid) {
                    for (var i2 in node.server.accessories.accessories[i]['services']) {
                        if (node.server.accessories.accessories[i]['services'][i2]['iid'] == sid) {
                            for (var i3 in node.server.accessories.accessories[i]['services'][i2]['characteristics']) {
                                if (node.server.accessories.accessories[i]['services'][i2]['characteristics'][i3]['type'] == cid) {
                                    res['service'] = node.server.accessories.accessories[i]['services'][i2]['type'];
                                    res['characteristic'] = node.server.accessories.accessories[i]['services'][i2]['characteristics'][i3]['type'];
                                }
                            }
                        }
                    }
                }
            }


            var serviceType = null;
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
            node.serviceType = serviceType

            return node.serviceType;
        }

        onMQTTConnect() {
            var node = this;

            // console.log('onMQTTConnect');

            node.sendStatus();
            // console.log(node.server.current_values[node.config.uid]);
            // node.current_values[node.config.uid][parts[6]] = messageString;

            // node.status({
            //     fill: "green",
            //     shape: "dot",
            //     text: "node-red-contrib-spruthub/in:status.connected"
            // });
            // node.cleanTimer = setTimeout(function () {
            //     node.status({}); //clean
            // }, 3000);


        }

        sendStatus() {
            var node = this;
            if (node.config.uid in node.server.current_values) {

                if (node.config.cid) { //output specified characteristic
                    // console.log(node.config);
                    // console.log(data.characteristic);
                    if (node.config.cid in node.server.current_values[node.config.uid]) {
                        // node.send({
                        //     topic: data.topic,
                        //     payload: payload,
                        //     uid: data.uid,
                        //     service: data.service,
                        //     characteristic: data.characteristic
                        // });

                        var unit = node.getServiceType()?node.getServiceType()['unit']:'';

                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: node.server.current_values[node.config.uid][node.config.cid] + (unit?' '+unit:'')
                        });
                    }
                } else { //output all
                    // node.send({
                    //     topic: data.topic,
                    //     payload: payload,
                    //     uid: data.uid,
                    //     service: data.service,
                    //     characteristic: data.characteristic
                    // });
                    //
                    // node.status({
                    //     fill: "green",
                    //     shape: "dot",
                    //     text: "node-red-contrib-spruthub/in:status.received"
                    // });
                    //
                    // clearTimeout(node.cleanTimer);
                    // node.cleanTimer = setTimeout(function () {
                    //     node.status({});
                    // }, 3000);
                }

            }
        }

        onMQTTMessage(data) {
            var node = this;

            // console.log(node.config.uid  + "  == "+ data.uid + '  =>  '+data.payload);
            if (node.config.uid == data.uid) {
                if (node.firstMsg && !node.config.outputAtStartup) {
                    node.firstMsg = false;
                    return;
                }

                var payload = SprutHubHelper.isNumber(data.payload)?parseFloat(data.payload):data.payload;

                if (node.config.cid) { //output specified characteristic
                    // console.log(node.config);
                    // console.log(data.characteristic);
                    if (node.config.cid == data.characteristic) {
                        node.send({
                            topic: data.topic,
                            payload: payload,
                            uid: data.uid,
                            service: data.service,
                            characteristic: data.characteristic
                        });

                        var unit = node.getServiceType()?node.getServiceType()['unit']:'';
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: payload + (unit?' '+unit:'')
                        });
                    }
                } else { //output all
                    node.send({
                        topic: data.topic,
                        payload: payload,
                        uid: data.uid,
                        service: data.service,
                        characteristic: data.characteristic
                    });

                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "node-red-contrib-spruthub/in:status.received"
                    });

                    clearTimeout(node.cleanTimer);
                    node.cleanTimer = setTimeout(function () {
                        node.status({});
                    }, 3000);
                }
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



