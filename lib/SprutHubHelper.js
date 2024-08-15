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
      //console.log('convertDevicesData', data)
      var devices = {};
      try{
        data.forEach((a) => {
          const device = {};
          const aId = a['id'];
          devices[aId] = device;

          device.aid = aId;
          device.roomId = a['roomId'];
          device.roomName = a['roomName'];
          device.manufacturer = a['manufacturer'];
          device.model = a['model'];
          device.serial = a['serial'];

          const services = {};
          device.services = services;
          if ("services" in a) {
            a.services.forEach((s) => {
              if (s.type !== "AccessoryInformation" && s.type !== "C_AccessoryExtInfo") {
                const service = {};
                Object.assign(service, s);
                services[s.sId] = service;

                const characteristics = {};
                service.characteristics = characteristics;
                const cs = s['characteristics'];
                if (cs != null) { // service 'C_Option' and 'C_Repeater' have no characteristics
                  cs.forEach((c) => {
                    characteristics[c.type] = c;
                  })
                }
              }
            })
          }
        })
      } catch(e) {
        console.error(e);
      }
      //console.log('convertDevicesData res', devices)
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

    static convertVarType(valueIn) {
        // bool boolValue = 1;
        // double doubleValue = 2;
        // int32 intValue = 3;
        // int64 longValue = 4;
        // string stringValue = 5;

        let value = null;

        if ('object' == typeof(valueIn)) {
            if ('boolValue' in valueIn) {
                value = valueIn.boolValue;
            } else if ('doubleValue' in valueIn) {
                value = valueIn.doubleValue;
            } else if ('intValue' in valueIn) {
                value = valueIn.intValue;
            } else if ('longValue' in valueIn) {
                value = valueIn.longValue;
            } else if ('stringValue' in valueIn) {
                value = valueIn.stringValue;
            }
        }
        return value;
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
