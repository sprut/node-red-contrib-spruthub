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
        return n != "" && !isNaN(n) && Math.round(n) == n;
    }

    static isFloat(n){
        return n != "" && !isNaN(n) && Math.round(n) != n;
    }

    static convertDevicesData(data) {
        var devices = {};

        if ("accessories" in data) {
            for (var i in data['accessories']) {
                var a = data['accessories'][i];
                devices[a['aid']] = {'AccessoryInformation':{}, 'C_AccessoryExtInfo':{}, 'services':{}};

                if ("services" in a) {
                    for (var i2 in a['services']) {
                        var s = a['services'][i2];

                        if ("AccessoryInformation" == s.type || "C_AccessoryExtInfo" == s.type) {
                            var characteristics = {};
                            Object.assign(characteristics, s);
// console.log(s);
                            devices[a['aid']][s.type] = {};
                            devices[a['aid']][s.type]['aid'] = a['aid'];
                            devices[a['aid']][s.type]['hidden'] = a['hidden'];
                            devices[a['aid']][s.type]['characteristics'] = {};

                            if ("characteristics" in s) {
                                for (var i3 in s['characteristics']) {
                                    var c = s['characteristics'][i3];
                                    // console.log(c);
                                    devices[a['aid']][s.type]['characteristics'][c.type] = c;
                                }
                            }
                        } else {
                            var characteristics = {};
                            Object.assign(characteristics, s['characteristics']);

                            devices[a['aid']]['services'][s.iid] = s;
                            devices[a['aid']]['services'][s.iid]['characteristics'] = {};
                            for (var i4 in characteristics) {
                                var c = characteristics[i4];
                                devices[a['aid']]['services'][s.iid]['characteristics'][c.type] = c;
                            }

                        }
                    }
                }
            }
        }
// console.log(devices);
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
        if (value === 'true') {
            value = true;
        } else if (value === 'false') {
            value = false;
        } else if (SprutHubHelper.isNumber(value)) {
            value = parseFloat(value);
        }
        return value;
    }
}

module.exports = SprutHubHelper;