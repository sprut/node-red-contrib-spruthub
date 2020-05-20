function spruthub_devicesSelect(val, options) {
    var $select = $("#node-input-uid");
    var $characteristic = $("#node-input-cid");
    var $server = $("#node-input-server");
    var $friendlyName = $("#node-input-friendly_name");
    var $refreshBtn = $("#force-refresh");
    var $showHidden = $("#node-input-showHidden");
    var withHidden = $showHidden.is(':checked');
    var $enableMultiple = $('#node-input-enableMultiple');

    options = $.extend({
        refresh:false,
        showHidden:withHidden
    }, options);


    $select.multipleSelect('destroy');
    $select.multipleSelect({
        single: !$enableMultiple.is(':checked'),
        maxHeight: 300,
        dropWidth: 320,
        width: 320,
        filter: true,
        filterPlaceholder: RED._("node-red-contrib-spruthub/server:multiselect.filter_devices")
    });
    $select.children().remove();
    $select.multipleSelect('refresh');
    $select.multipleSelect('disable');

    spruthub_characteristicsSelect({}, null);

    $.getJSON('spruthub/getDevices', {
        controllerID: $server.val()
    }).done(function (data, textStatus, jqXHR) {

        var groupHtml = '';
        var devices = data;
        var characteristics = {};
        $.each(devices, function(index, value) {
            if (Object.keys(value.services).length) {
                if (!value.AccessoryInformation.hidden || (value.AccessoryInformation.hidden && withHidden)) {
                    groupHtml = $('<optgroup/>', {label: value.AccessoryInformation.characteristics.Name.value + "<br><i class='sh_serial'>" + value.AccessoryInformation.characteristics.Model.value + ": " + value.AccessoryInformation.characteristics.SerialNumber.value + "</i>"});
                    groupHtml.appendTo($select);
                    $.each(value.services, function (index2, value2) {
                        if (!value2.hidden || (value2.hidden && withHidden)) {
                            $('<option value="' + value.AccessoryInformation.aid+"_"+value2.iid + '">' + value2.characteristics.Name.value + '</option>').appendTo(groupHtml);

                            //selected
                            if (!$enableMultiple.is(':checked') && val == value.AccessoryInformation.aid+"_"+value2.iid) {
                                characteristics = value2.characteristics;
                            }
                        }
                    });
                }
            }
        });

        $select.multipleSelect('enable');
        $select.multipleSelect('refresh');

        if ($enableMultiple.is(':checked') && typeof(val) == 'object') {
            for (var index in val) {
                $select.multipleSelect('check', val[index]);
            }
        } else {
            $select.multipleSelect('check', val);
        }

        spruthub_characteristicsSelect(devices, options.cid);

        $select.off('change').on('change', function(){
            if (!$enableMultiple.is(':checked')) {
                var selectedValues = $select.multipleSelect('getSelects', 'text');
                $friendlyName.val(selectedValues.length == 1 ? selectedValues[0] : '');
            } else {
                var cnt = $select.multipleSelect('getSelects').length;
                $friendlyName.val(cnt + " " + (cnt > 1?RED._("node-red-contrib-spruthub/server:label.accessories"):RED._("node-red-contrib-spruthub/server:label.accessory")));
            }

            var selectedCharacteristic = $characteristic.multipleSelect('getSelects');
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
        spruthub_devicesSelect(val, options);
    });
    $showHidden.off('change').on('change', function(){
        spruthub_devicesSelect(val, options);
    });
    $enableMultiple.off('change').on('change', function(){
        spruthub_devicesSelect(val, options);
    });
}

function spruthub_characteristicsSelect(devices, cid) {
    var $service = $("#node-input-uid");
    var $characteristic_wr = $("#sh_cid_wr");
    var $characteristic = $("#node-input-cid");
    var enableMultiple = $('#node-input-enableMultiple').is(':checked');


    $characteristic.multipleSelect('destroy');
    $characteristic.multipleSelect({
        single: true,
        maxHeight: 300,
        dropWidth: 320,
        width: 320,
        filter: false
    });
    $characteristic.children().remove();
    $('<option value="0">' + RED._("node-red-contrib-spruthub/server:multiselect.all") + '</option>').appendTo($characteristic);


    if (enableMultiple) {
        $characteristic_wr.hide();
        return;
    } else {
        $characteristic.multipleSelect('disable');
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
                    if (uid == value.AccessoryInformation.aid + "_" + value2.iid) {
                        characteristics = value2.characteristics;
                    }
                });
            }
        });
    }

    if (characteristics) {
        $.each(characteristics, function (index, c) {
            $('<option value="' + c.type + '">' + c.type + '</option>').appendTo($characteristic);
            // $('<option value="' + c.iid + '">' + c.type + ' (' + c.value + ')' + '</option>').appendTo($characteristic);
        });
        $characteristic.val(cid);
    } else {
        $characteristic.val(0);
    }

    $characteristic.multipleSelect('enable');
    $characteristic.multipleSelect('refresh');
}

function spruthub_truncateWithEllipses(text, max = 30) {
    if (text) {
        return text.substr(0, max - 1) + (text.length > max ? '&hellip;' : '');
    } else {
        return text;
    }
}



