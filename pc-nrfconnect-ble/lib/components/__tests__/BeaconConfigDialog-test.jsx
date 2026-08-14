/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';
import enzyme, { shallow } from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import { logger } from 'pc-nrfconnect-shared';

import { appendDeviceParametersToCsv } from '../../utils/appendToCsv';
import {
    createIbeaconCommand,
    IBEACON_COMMAND,
} from '../../utils/ibeaconProtocol';
import {
    BeaconConfigDialog,
    DEFAULT_IBEACON_PASSWORD,
} from '../BeaconConfigDialog';

enzyme.configure({ adapter: new Adapter() });

jest.mock('pc-nrfconnect-shared', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
    },
}));

jest.mock('../../utils/appendToCsv', () => ({
    appendDeviceParametersToCsv: jest.fn(),
}));

const device = { address: 'AA:BB:CC:DD:EE:FF', instanceId: 'device.1' };
const configuration = {
    writeCharacteristic: { instanceId: 'write.1' },
    responseCharacteristic: { instanceId: 'notify.1' },
};

function createDialog(overrides = {}) {
    return shallow(
        <BeaconConfigDialog
            device={device}
            deviceDetails={null}
            onHide={() => {}}
            onPrepare={() => Promise.resolve(configuration)}
            onWriteCharacteristic={() => {}}
            {...overrides}
        />,
        { disableLifecycleMethods: true }
    );
}

describe('BeaconConfigDialog', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('verifies the default password after notifications are enabled', async () => {
        const onWriteCharacteristic = jest.fn();
        const wrapper = createDialog({ onWriteCharacteristic });

        await wrapper.instance().prepare();

        expect(onWriteCharacteristic).toHaveBeenCalledWith(
            configuration.writeCharacteristic,
            expect.any(Array)
        );
        expect(wrapper.state('pendingCommand')).toBe(
            IBEACON_COMMAND.PASSWORD_CHECK
        );
        expect(wrapper.state('values').password).toBe(DEFAULT_IBEACON_PASSWORD);
    });

    it('prefills configuration values from the scanned iBeacon advertisement', async () => {
        const scannedDevice = {
            adData: new Map([
                [
                    'BLE_GAP_AD_TYPE_MANUFACTURER_SPECIFIC_DATA',
                    '76,0,2,21,0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255,1,2,3,4,197',
                ],
                ['BLE_GAP_AD_TYPE_TX_POWER_LEVEL', -4],
            ]),
        };
        const wrapper = createDialog({
            device: {
                ...device,
                adData: new Map(),
            },
            scannedDevice,
        });

        await wrapper.instance().prepare();

        expect(wrapper.state('values')).toMatchObject({
            password: DEFAULT_IBEACON_PASSWORD,
            uuid: '00112233445566778899AABBCCDDEEFF',
            major: '258',
            minor: '772',
            rssiAt1m: '-59',
            txPower: '-4',
            broadcastInterval: '100',
        });
    });

    it('logs the raw password verification frame before writing it', async () => {
        const debug = jest.spyOn(logger, 'debug').mockImplementation(() => {});
        const wrapper = createDialog();

        await wrapper.instance().prepare();

        expect(debug).toHaveBeenCalledWith(
            expect.stringContaining(
                '[iBeacon] command send command=PASSWORD_CHECK'
            )
        );
        expect(debug).toHaveBeenCalledWith(expect.stringContaining('A1-05-E0'));
    });

    it('asks for a password when password verification is rejected', () => {
        const wrapper = createDialog();
        wrapper.setState({
            configuration,
            pendingCommand: IBEACON_COMMAND.PASSWORD_CHECK,
            passwordRequired: false,
        });

        wrapper.instance().handleResponse([0xa1, 0x02, 0xe0, 0x01, 0x42]);

        expect(wrapper.state('passwordRequired')).toBe(true);
        expect(wrapper.state('status')).toContain('password');
    });

    it('records a successful device parameter update but not password verification', () => {
        const wrapper = createDialog();
        wrapper.setState({
            configuration,
            pendingCommand: IBEACON_COMMAND.UUID_SET,
            values: {
                ...wrapper.state('values'),
                uuid: '00112233445566778899AABBCCDDEEFF',
                major: '258',
                minor: '772',
                rssiAt1m: '-59',
                txPower: '-4',
                broadcastInterval: '100',
            },
        });

        wrapper
            .instance()
            .handleResponse([
                0xa1, 0x12, 0xf1, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
                0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
                0xe8,
            ]);

        expect(appendDeviceParametersToCsv).toHaveBeenCalledWith({
            mac: device.address,
            uuid: '00112233445566778899AABBCCDDEEFF',
            major: '258',
            minor: '772',
            rssiAt1m: '-59',
            txPower: '-4',
            broadcastInterval: '100',
        });

        appendDeviceParametersToCsv.mockClear();
        wrapper.setState({ pendingCommand: IBEACON_COMMAND.PASSWORD_CHECK });
        wrapper.instance().handleResponse([0xa1, 0x02, 0xe0, 0x00, 0x1c]);

        expect(appendDeviceParametersToCsv).not.toHaveBeenCalled();
    });

    it('sends encoded Major and then Minor when a GLD serial number is submitted', () => {
        const onWriteCharacteristic = jest.fn();
        const wrapper = createDialog({
            gldVersion: true,
            onWriteCharacteristic,
        });
        wrapper.setState({
            configuration,
            verified: true,
            values: {
                ...wrapper.state('values'),
                batteryLevel: '5',
                serialNumber: '19088743',
            },
        });

        wrapper.instance().submitGldSerialNumber();

        expect(onWriteCharacteristic).toHaveBeenCalledWith(
            configuration.writeCharacteristic,
            createIbeaconCommand(IBEACON_COMMAND.MAJOR_SET, '20771')
        );

        wrapper
            .instance()
            .handleResponse([0xa1, 0x06, 0xf2, 0x00, 0x51, 0x23, 0x45, 0x67, 0x4e]);

        expect(onWriteCharacteristic).toHaveBeenLastCalledWith(
            configuration.writeCharacteristic,
            createIbeaconCommand(IBEACON_COMMAND.MINOR_SET, '17767')
        );
    });

    it('parses a scanner Major,Minor payload and starts a pair write', () => {
        const onWriteCharacteristic = jest.fn();
        const wrapper = createDialog({ onWriteCharacteristic });
        wrapper.setState({ configuration, verified: true, scannerInput: '18504,19226' });

        wrapper.instance().submitScannerInput();

        expect(wrapper.state('values')).toMatchObject({
            major: '18504',
            minor: '19226',
        });
        expect(onWriteCharacteristic).toHaveBeenCalledWith(
            configuration.writeCharacteristic,
            createIbeaconCommand(IBEACON_COMMAND.MAJOR_SET, '18504')
        );
    });

    it('rejects an SN scanner payload outside GLD mode', () => {
        const wrapper = createDialog({ gldVersion: false });
        wrapper.setState({ configuration, verified: true, scannerInput: '202606107' });

        wrapper.instance().submitScannerInput();

        expect(wrapper.state('statusType')).toBe('danger');
    });

    it('rejects a scanner SN that is not nine digits', () => {
        const wrapper = createDialog({ gldVersion: true });
        wrapper.setState({ configuration, verified: true, scannerInput: '20260610' });

        wrapper.instance().submitScannerInput();

        expect(wrapper.state('statusType')).toBe('danger');
    });
});
