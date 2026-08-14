/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

'use strict';

import { List, OrderedMap, Record } from 'immutable';
import { logger } from 'pc-nrfconnect-shared';

import * as AdapterAction from '../actions/adapterActions';
import * as DiscoveryAction from '../actions/discoveryActions';
import { persistentStore } from '../common/Persistentstore';
import * as apiHelper from '../utils/api';
import { appendScanToCsv } from '../utils/appendToCsv';

export const DiscoveryOptions = params =>
    new Record({
        expanded: false,
        sortByRssi: true,
        namefilterString: '',
        rawDatafilterString: '9999',
        // rawDatafilterString: 'BF7B2DD963FE109F',
        scanInterval: 100,
        scanWindow: 20,
        scanTimeout: persistentStore.scanTimeout(),
        activeScan: persistentStore.activeScan(),
        gldVersion: persistentStore.gldVersion(),
        filterRegexp: '',
    })(params);

const getInitialState = () =>
    new Record({
        devices: OrderedMap(),
        errors: List(),
        options: DiscoveryOptions(),
    })();

function scanStarted(state) {
    logger.info('Scan started');
    return state;
}

function appendDeviceScanRecord(device, reason) {
    const rssiSamples = device.allRssi.filter(Number.isFinite);
    if (rssiSamples.size === 0) {
        logger.warn(
            `[scan-csv] skipped reason=${reason} address=${device.address} no RSSI samples`
        );
        return;
    }

    const average =
        rssiSamples.reduce((sum, rssi) => sum + rssi, 0) / rssiSamples.size;
    const record = {
        avg: `${average.toFixed(2)} dBm`,
        max: `${rssiSamples.max()} dBm`,
        min: `${rssiSamples.min()} dBm`,
        mac: device.address,
    };
    logger.info(
        `[scan-csv] append reason=${reason} address=${record.mac} samples=${rssiSamples.size} avg=${record.avg} max=${record.max} min=${record.min}`
    );
    const csvPath = appendScanToCsv(record);
    logger.info(`[scan-csv] appended path=${csvPath}`);
}

function scanStopped(state) {
    logger.info('Scan stopped');
    const { devices, options } = state;
    let foundDevice = null;

    if (options.rawDatafilterString) {
        foundDevice = devices.find(
            device =>
                device.services.size > 0 &&
                device.services.some(service =>
                    service.includes(options.rawDatafilterString)
                )
        );
    }

    // 如果没找到满足条件的设备或没有过滤条件，就取第一个设备
    if (!foundDevice && devices.size > 0) {
        foundDevice = devices.first();
    }

    if (foundDevice) {
        appendDeviceScanRecord(foundDevice, 'scan-stopped');
    } else {
        logger.warn(
            '[scan-csv] skipped reason=scan-stopped no discovered device'
        );
    }
    return state;
}

function applyFilters(oldState) {
    let state = oldState;

    if (state.options.sortByRssi) {
        const orderedDevices = state.devices.sort((dev1, dev2) => {
            if (dev1.rssi < dev2.rssi) return 1;
            if (dev1.rssi > dev2.rssi) return -1;
            return 0;
        });
        state = state.set('devices', orderedDevices);
    }

    return state;
}

function deviceDiscovered(oldState, device) {
    let state = oldState;
    let newDevice = apiHelper.getImmutableDevice(device);
    const existingDevice = state.devices.get(device.address);

    if (existingDevice) {
        // Keep exising name if new name is empty
        if (existingDevice.name !== '' && !device.name) {
            newDevice = newDevice.setIn(['name'], existingDevice.name);
        }

        // Keep existing list of services if new list is empty
        if (existingDevice.services.size > 0 && device.services.length === 0) {
            newDevice = newDevice.setIn(['services'], existingDevice.services);
        }
        newDevice = newDevice.setIn(['isExpanded'], existingDevice.isExpanded);

        // Merge existing adData with new to keep everything that is not updated
        const adData = existingDevice.adData.merge(newDevice.adData);
        newDevice = newDevice.mergeIn(['adData'], adData);

        newDevice = newDevice.setIn(
            ['allRssi'],
            existingDevice.allRssi.concat(newDevice.rssi)
        );
    } else {
        newDevice = newDevice.setIn(
            ['allRssi'],
            newDevice.allRssi.concat(newDevice.rssi)
        );
    }

    logger.debug(`address: ${device.address}, allRssi: ${newDevice.allRssi}`);

    if (newDevice.name === null) {
        newDevice = newDevice.setIn(['name'], '');
    }

    state = state.setIn(['devices', device.address], newDevice);

    state = applyFilters(state);

    return state;
}

function addError(state, error) {
    return state.set('errors', state.errors.push(error));
}

function clearList(state) {
    return state.set('devices', state.devices.clear());
}

function deviceConnect(state, device) {
    const discoveredDevice = state.devices.get(device.address);
    if (discoveredDevice) {
        // adapter.connect() stops scanning internally, without dispatching
        // DISCOVERY_SCAN_STOPPED, so persist the selected scan before connecting.
        appendDeviceScanRecord(discoveredDevice, 'device-connect');
        return state.setIn(['devices', device.address, 'isConnecting'], true);
    }
    return state;
}

function deviceConnected(state, device) {
    if (state.devices.get(device.address)) {
        return state
            .setIn(['devices', device.address, 'isConnecting'], false)
            .setIn(['devices', device.address, 'connected'], true);
    }
    return state;
}

function deviceDisconnected(state, device) {
    if (state.devices.get(device.address)) {
        return state.setIn(['devices', device.address, 'connected'], false);
    }
    return state;
}

function deviceConnectTimeout(state, deviceAddress) {
    logger.info('Connection to device timed out');
    return state.setIn(
        ['devices', deviceAddress.address, 'isConnecting'],
        false
    );
}

function deviceCancelConnect(state) {
    const newDevices = state.devices.map(device =>
        device.set('isConnecting', false)
    );
    return state.set('devices', newDevices);
}

function toggleExpanded(state, deviceAddress) {
    return state.updateIn(
        ['devices', deviceAddress, 'isExpanded'],
        value => !value
    );
}

function toggleOptionsExpanded(state) {
    return state.updateIn(['options', 'expanded'], value => !value);
}

function discoverySetOptions(state, options) {
    persistentStore.setGldVersion(options.gldVersion);
    const newOptions = {
        ...options,
        filterRegexp: new RegExp(options.namefilterString, 'i'),
    };
    return applyFilters(state.set('options', DiscoveryOptions(newOptions)));
}

function setTimeout(state, value) {
    persistentStore.setScanTimeout(+value);
    return state.setIn(['options', 'scanTimeout'], +value);
}

function toggleActiveScan(state) {
    persistentStore.setActiveScan(!state.options.activeScan);
    return state.updateIn(['options', 'activeScan'], value => !value);
}

export default function discovery(state = getInitialState(), action) {
    switch (action.type) {
        case DiscoveryAction.DISCOVERY_CLEAR_LIST:
            return clearList(state);
        case DiscoveryAction.ERROR_OCCURED:
            return addError(state, action.error);
        case DiscoveryAction.DISCOVERY_SCAN_STARTED:
            return scanStarted(state);
        case DiscoveryAction.DISCOVERY_SCAN_STOPPED:
            return scanStopped(state);
        case DiscoveryAction.DISCOVERY_TOGGLE_EXPANDED:
            return toggleExpanded(state, action.deviceAddress);
        case DiscoveryAction.DISCOVERY_TOGGLE_OPTIONS_EXPANDED:
            return toggleOptionsExpanded(state);
        case DiscoveryAction.DISCOVERY_SET_OPTIONS:
            return discoverySetOptions(state, action.options);
        case DiscoveryAction.DISCOVERY_SET_TIMEOUT:
            return setTimeout(state, action.value);
        case DiscoveryAction.DISCOVERY_ACTIVE_SCAN:
            return toggleActiveScan(state);
        case AdapterAction.DEVICE_DISCOVERED:
            return deviceDiscovered(state, action.device);
        case AdapterAction.DEVICE_CONNECT:
            return deviceConnect(state, action.device);
        case AdapterAction.DEVICE_CONNECTED:
            return deviceConnected(state, action.device);
        case AdapterAction.DEVICE_DISCONNECTED:
            return deviceDisconnected(state, action.device);
        case AdapterAction.DEVICE_CONNECT_TIMEOUT:
            return deviceConnectTimeout(state, action.deviceAddress);
        case AdapterAction.DEVICE_CANCEL_CONNECT:
            return deviceCancelConnect(state);
        case AdapterAction.ADAPTER_RESET_PERFORMED:
            return getInitialState();
        case AdapterAction.ADAPTER_CLOSED:
            return getInitialState();
        default:
            return state;
    }
}
