function spruthub_devicesSelect(val, options) {
    var $select = $("#node-input-uid");
    var $characteristicId = $("#node-input-cid");
    var $server = $("#node-input-server");
    var $friendlyName = $("#node-input-friendly_name");
    var $refreshBtn = $("#force-refresh");
    var $showHidden = $("#node-input-showHidden");
    var withHidden = $showHidden.is(':checked');
    var $enableMultiple = $('#node-input-enableMultiple');

    options = $.extend({
        refresh:false,
        showHidden:withHidden,
        allowEmpty:false
    }, options);

    $select.multipleSelect('destroy');
    $select.multipleSelect({
        single: !$enableMultiple.is(':checked'),
        maxHeight: 300,
        dropWidth: 320,
        width: 320,
        minimumCountSelected:!$enableMultiple.is(':checked')?1:0,
        filter: true,
        filterPlaceholder: RED._("node-red-contrib-spruthub/server:multiselect.filter_devices")
    });
    $select.children().remove();
    $select.multipleSelect('refresh');
    $select.multipleSelect('disable');

    spruthub_characteristicsSelect({}, null);

    $.getJSON('spruthub/getDevices', {
        controllerID: $server.val(),
        forceRefresh: options.refresh
    }).done(function (data, textStatus, jqXHR) {
        var groupHtml = '';

        if (!$enableMultiple.is(':checked')) {
            if (options.allowEmpty) {
                $('<option value="">msg.topic</option>').appendTo($select);
            }
        }

        var devices = data;
        var characteristics = {};
        // console.log(devices);
        $.each(devices, function(index, value) {

            if (Object.keys(value.services).length) {
                // var group = Object.keys(value.services).length > 1;
                if (!value.AccessoryInformation.hidden || (value.AccessoryInformation.hidden && withHidden)) {

                    var room = "C_AccessoryExtInfo" in value && "C_Room" in value.C_AccessoryExtInfo.characteristics && value.C_AccessoryExtInfo.characteristics.C_Room.value?'<sup> ('+value.C_AccessoryExtInfo.characteristics.C_Room.value+')</sup>':'';

                    // if (group) {
                    //     groupHtml = $('<optgroup/>', {
                    //         label: value.AccessoryInformation.characteristics.Name.value + "<br><i class='sh_serial'>" +
                    //             value.AccessoryInformation.characteristics.Model.value + ": " + value.AccessoryInformation.characteristics.SerialNumber.value +
                    //             "</i>"
                    //     });
                    //     groupHtml.appendTo($select);
                    // }

                    $.each(value.services, function(index2, value2) {
                        if (!value2.hidden || (value2.hidden && withHidden)) {

                            // if (group) {
                            //     $('<option value="' + value.AccessoryInformation.aid + "_" + value2.iid + '">' + value2.characteristics.Name.value+ room +
                            //         '</option>').appendTo(groupHtml);
                            // } else {
                            if ("characteristics" in value2 && "Name" in value2.characteristics) { //homekit controller bug
                                // aId: 201
                                // characteristics: {C_TargetPositionState: {…}, Name: {…}, CurrentPosition: {…}, PositionState: {…}, TargetPosition: {…}}
                                // data: {Logic: {…}}
                                // googleType: "WINDOW"
                                // mailRuType: "OPENABLE$CURTAIN"
                                // name: "Штора"
                                // rawName: "Штора"
                                // sId: 11
                                // type: "WindowCovering"
                                // typeName: "Штора"
                                // visible: true
                                // yandexType: "OPENABLE$CURTAIN"
                                $('<option value="' + value2.aId+ "_" + value2.sId + '"><b>' + value2.characteristics.Name.value + "</b>" +
                                    room + "<br>  <i class='sh_serial'>" +
                                    value.AccessoryInformation.characteristics.Model.value + ": " +
                                    value.AccessoryInformation.characteristics.SerialNumber.value +
                                    "</i>" +
                                    '</option>').appendTo($select);

                                //selected
                                if (!$enableMultiple.is(':checked') && val == value2.aId + "_" + value2.sId) {
                                    characteristics = value2.characteristics;
                                }
                            }
                        }
                    });
                }
            }
        });

        $select.multipleSelect('enable');
        $select.multipleSelect('refresh');
        if ($enableMultiple.is(':checked') && typeof(val) == 'object') {
            $select.multipleSelect('setSelects', val);
            // for (var index in val) {
            //     console.log(val[index]);
            //     // $select.multipleSelect('check', val[index]);
            // }
        } else {
            if (typeof(val) == 'object') {
                for (var index in val) {
                    $select.multipleSelect('check', val[index]);
                }
            } else {
                $select.multipleSelect('check', val);
            }
        }

        spruthub_characteristicsSelect(devices, options.cid);

        function stripHtml(html){
            let $html = $('<div>'+html+'</div>');
            return $html.find('b').text()+' '+$html.find('sup').text();
        }

        $select.off('change').on('change', function(){
            if (!$enableMultiple.is(':checked')) {
                var selectedValues = $select.multipleSelect('getSelects', 'text');
                $friendlyName.val(selectedValues.length == 1 ? stripHtml(selectedValues[0]) : '');
            } else {
                var cnt = $select.multipleSelect('getSelects').length;
                $friendlyName.val(cnt + " " + (cnt > 1?RED._("node-red-contrib-spruthub/server:label.accessories"):RED._("node-red-contrib-spruthub/server:label.accessory")));
            }

            var selectedCharacteristic = $characteristicId.multipleSelect('getSelects');
            spruthub_characteristicsSelect(devices, selectedCharacteristic.length?selectedCharacteristic[0]:null);
        });


    }).fail(function (jqXHR, textStatus, errorThrown) {
        $select.multipleSelect('disable');
    });

    //some binds
    $server.off('change').on('change', function(){
        spruthub_devicesSelect(val, options);
    });
    $refreshBtn.off('click').on('click', function(){
        options.refresh = true;
        spruthub_devicesSelect(val, options);
    });
    $showHidden.off('change').on('change', function(){
        options['showHidden'] = $showHidden.is(':checked');
        spruthub_devicesSelect(val, options);
    });
    $enableMultiple.off('change').on('change', function(){
        spruthub_devicesSelect(val, options);
    });
}

function spruthub_characteristicsSelect(devices, cid) {
    var $service = $("#node-input-uid");
    var $characteristic_wr = $("#sh_cid_wr");
    var $characteristicId = $("#node-input-cid");
    var $characteristicType = $("#node-input-ctype");
    var enableMultiple = $('#node-input-enableMultiple').is(':checked');
    var $friendlyName = $("#node-input-friendly_name");


    $characteristicId.multipleSelect('destroy');
    $characteristicId.multipleSelect({
        single: true,
        maxHeight: 300,
        dropWidth: 320,
        width: 320,
        filter: false
    });
    $characteristicId.children().remove();

    if ($characteristicId.data('first')) {
        $('<option value="0">' + RED._($characteristicId.data('first')) + '</option>').appendTo($characteristicId);
    } else {
        $('<option value="0">' + RED._("node-red-contrib-spruthub/server:multiselect.all") + '</option>').appendTo($characteristicId);
    }



    if (enableMultiple) {
        $characteristic_wr.hide();
        return;
    } else {
        $characteristicId.multipleSelect('disable');
        $characteristic_wr.show();
    }
    if (!devices) return;


    var characteristics = {};

    var selectedValues = $service.multipleSelect('getSelects');
    var uid = selectedValues[0];


    if (uid) {
        $.each(devices, function (index, value) {
            if (Object.keys(value.services).length) {
                $.each(value.services, function (index2, value2) {
                    if (uid == value2.aId + "_" + value2.sId) {
                        characteristics = value2.characteristics;
                    }
                });
            }
        });
    }

    if (characteristics) {
        $.each(characteristics, function (index, c) {
            // aId: 147
            // cId: 14
            // data: {}
            // desc: "Name"
            // events: false
            // format: "string"
            // hidden: false
            // maxLen: 64
            // read: true
            // sId: 13
            // type: "Name"
            // typeName: "Имя"
            // value: "Батарея"
            // write: false
            $('<option value="' + c.cId + '" data-ctype="'+c.type+'">' + c.typeName + ' ('+c.type +')' + '</option>').appendTo($characteristicId);
        });
        $characteristicId.val(cid);
    } else {
        $characteristicId.val(0);
    }

    $characteristicId.multipleSelect('enable');
    $characteristicId.multipleSelect('refresh');
    $characteristicId.off('change').on('change', function(){
        let friendlyName = $('<div>'+$service.multipleSelect('getSelects', 'text')[0]+'</div>').find('b').text() + ' ' + $('<div>'+$service.multipleSelect('getSelects', 'text')[0]+'</div>').find('sup').text();
        $friendlyName.val(friendlyName + ($characteristicId.val()>0?' : '+$characteristicId.multipleSelect('getSelects', 'text')[0].replace(/(.*)\s\((.*)\)/, '$1'):''));
    });
}

function spruthub_truncateWithEllipses(text, max = 30) {
    if (text) {
        return text.substr(0, max - 1) + (text.length > max ? '&hellip;' : '');
    } else {
        return text;
    }
}



