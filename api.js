const SprutHubHelper = require('./lib/SprutHubHelper.js');
var NODE_PATH = '/spruthub/';

module.exports = function(RED) {

    RED.httpAdmin.get(NODE_PATH + 'static/*', function (req, res) {
        var options = {
            root: __dirname + '/static/',
            dotfiles: 'deny'
        };
        res.sendFile(req.params[0], options);
    });

    RED.httpAdmin.get(NODE_PATH + 'checkConnection', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            controller.checkConnection(config).then(function(response){
                res.json(response);
            }).catch(error => {
                res.json({error:error});
            });
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'getDevices', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        var force = config.forceRefresh ? ['1', 'yes', 'true'].includes(config.forceRefresh.toLowerCase()) : false;

        if (controller && controller.constructor.name === "ServerNode") {
            controller.getAccessories(force).then(function(response){
                res.json(SprutHubHelper.convertDevicesData(response));
            }).catch(error => {
                res.json(error);
            });
        } else {
            res.status(404).end();
        }
    });
}
