'use strict';

class SprutHubHelper {
    static isJson(str) {
        try {
            JSON.parse(str);
        } catch (e) {
            return false;
        }
        return true;
    }
    static isNumber(n)
    {
        return SprutHubHelper.isInt(n) || SprutHubHelper.isFloat(n);
    }

    static isInt(n)
    {
        if (n === 'true' || n === true || n === 'false' || n === false) return false;
        return n !== "" && !isNaN(n) && Math.round(n) === n;
    }

    static isFloat(n){
        if (n === 'true' || n === true || n === 'false' || n === false) return false;
        return n !== "" && !isNaN(n) && Math.round(n) !== n;
    }

    static convertDevicesData(data) {
        var devices = {};

        for (var i in data) {
            var a = data[i];
            devices[a['id']] = {'AccessoryInformation':{}, 'C_AccessoryExtInfo':{}, 'services':{}};

            if ("services" in a) {
                for (var i2 in a['services']) {
                    var s = a['services'][i2];

                    if ("AccessoryInformation" == s.type || "C_AccessoryExtInfo" == s.type) {
                        var characteristics = {};
                        Object.assign(characteristics, s);

                        devices[a['id']][s.type] = {};
                        devices[a['id']][s.type]['aid'] = a['id'];
                        devices[a['id']][s.type]['hidden'] = !a['visible']; //todo remove
                        devices[a['id']][s.type]['visible'] = a['visible'];
                        devices[a['id']][s.type]['characteristics'] = {};

                        if ("characteristics" in s) {
                            for (var i3 in s['characteristics']) {
                                var c = s['characteristics'][i3];
                                // console.log(c);
                                devices[a['id']][s.type]['characteristics'][c.type] = c;
                            }
                        }
                    } else {
                        var characteristics = {};
                        Object.assign(characteristics, s['characteristics']);

                        devices[a['id']]['services'][s.sId] = s;
                        devices[a['id']]['services'][s.sId]['characteristics'] = {};
                        for (var i4 in characteristics) {
                            var c = characteristics[i4];
                            devices[a['id']]['services'][s.sId]['characteristics'][c.type] = c;
                        }
                    }
                }
            }
        }


        return devices;
    }

    static formatMath(data) {
        var result = {};

        for (var i in data) {
            for (var key in data[i]) {
                var val = data[i][key];
                if (SprutHubHelper.isNumber(val)) {
                    if (!(key in result)) result[key] = {"count": 0, "avg": 0, "min": null, "max": null, "sum": 0};

                    result[key]["count"] += 1;
                    result[key]["sum"] =  Math.round((result[key]["sum"] + val) * 100) / 100;
                    result[key]["min"] = result[key]["min"] == null || val < result[key]["min"] ? val : result[key]["min"];
                    result[key]["max"] = result[key]["max"] == null || val > result[key]["max"] ? val : result[key]["max"];
                    result[key]["avg"] = Math.round((result[key]["sum"] / result[key]["count"]) * 100) / 100;
                }
            }
        }

        return result;
    }

    static convertVarType(value) {
        if (typeof(value) == 'string' && value.toLowerCase() === 'true') {
            value = true;
        } else if (typeof(value) == 'string' && value.toLowerCase() === 'false') {
            value = false;
        } else if (SprutHubHelper.isNumber(value)) {
            value = parseFloat(value);
        }
        return value;
    }

    static formatValue(val, format) {
        if (typeof(val) == 'object') return val;

        switch (format) {
            case 'bool':
                val = !!this.convertVarType(val);
                break;

            case 'uint32':
            case 'int':
                val = parseInt(val);

                break;
            case 'float':
                val = parseFloat(val);
                break;

            case 'string':
                val += '';
                break;
        }

        return val;
    }

    static generateElementId(topic) {
        var arr = topic.split('/');
        return 'sh-'+(arr[3]+'-'+arr[4]+(5 in arr && arr[5]!='#'?'-'+arr[5]:'')).replace(/[^a-zA-Z0-9_-]/g, '');
    }

    static parseTopic(topic) {
        var result = {};
        var parts = topic.split('/');

        if (parts.length >= 5 && parts[2] === 'accessories') {
            result.aid = parts[3];
            result.sid = parts[4];
            result.cid = parts[5];
            result.uid = result.aid+"_"+result.sid;
        }

        return result;
    }

    static statusUpdatedAt() {
        return ' [' + new Date().toLocaleDateString('ru-RU') + ' ' + new Date().toLocaleTimeString('ru-RU') + ']'

        // let textSuffix = '';
        // if (topic in serverNode.devices && 'change' in serverNode.devices[topic] && serverNode.devices[topic].change.updated_at) {
        //     // if (new Date().toDateString() != new Date(serverNode.devices[topic].change.updated_at).toDateString()) {
        //     textSuffix += new Date(serverNode.devices[topic].change.updated_at).toLocaleDateString('ru-RU') + ' ';
        //     // }
        //     textSuffix += new Date(serverNode.devices[topic].change.updated_at).toLocaleTimeString('ru-RU');
        //     textSuffix = '['+textSuffix+']';
        // }
        // return textSuffix;
    }
}

module.exports = SprutHubHelper;
