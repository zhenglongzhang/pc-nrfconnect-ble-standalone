/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import {
    createIbeaconCommand,
    findIbeaconConfigurationAttributes,
    IBEACON_COMMAND,
    parseIbeaconResponse,
} from '../ibeaconProtocol';

describe('iBeacon configuration protocol', () => {
    it('encodes password verification using the reference wire format', () => {
        expect(
            createIbeaconCommand(IBEACON_COMMAND.PASSWORD_CHECK, '123456')
        ).toEqual([0xa1, 0x05, 0xe0, 0x00, 0x01, 0xe2, 0x40, 0x7d]);
    });

    it('encodes UUID, signed RSSI and broadcast interval commands', () => {
        expect(
            createIbeaconCommand(
                IBEACON_COMMAND.UUID_SET,
                '00112233445566778899aabbccddeeff'
            )
        ).toEqual([
            0xa1, 0x11, 0xf1, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
            0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x74,
        ]);
        expect(createIbeaconCommand(IBEACON_COMMAND.RSSI_SET, '-59')).toEqual([
            0xa1, 0x02, 0xf4, 0xc5, 0x3e,
        ]);
        expect(
            createIbeaconCommand(IBEACON_COMMAND.BROADCAST_INTERVAL_SET, '100')
        ).toEqual([0xa1, 0x03, 0xf6, 0x00, 0xa0, 0x85]);
    });

    it('rejects invalid configuration values before sending a command', () => {
        expect(() =>
            createIbeaconCommand(IBEACON_COMMAND.UUID_SET, 'not-a-uuid')
        ).toThrow('32 hexadecimal characters');
        expect(() =>
            createIbeaconCommand(IBEACON_COMMAND.MAJOR_SET, '65536')
        ).toThrow('0 and 65535');
        expect(() =>
            createIbeaconCommand(IBEACON_COMMAND.RSSI_SET, '1')
        ).toThrow('-127 and 0');
    });

    it('parses a successful RSSI response only when its CRC is valid', () => {
        expect(
            parseIbeaconResponse([0xa1, 0x03, 0xf4, 0x00, 0xc5, 0x90])
        ).toEqual({
            command: IBEACON_COMMAND.RSSI_SET,
            success: true,
            values: { rssiAt1m: -59 },
        });
        expect(() =>
            parseIbeaconResponse([0xa1, 0x03, 0xf4, 0x00, 0xc5, 0x91])
        ).toThrow('CRC');
    });

    it('selects the first write-with-response and notification characteristic', () => {
        const firstWritable = {
            instanceId: 'write',
            properties: { write: true, writeWoResp: false },
        };
        const firstNotifiable = {
            instanceId: 'notify',
            properties: { notify: true },
            descriptors: [{ uuid: '2902', instanceId: 'cccd' }],
        };

        expect(
            findIbeaconConfigurationAttributes([
                { properties: { writeWoResp: true } },
                firstWritable,
                firstNotifiable,
            ])
        ).toEqual({
            writeCharacteristic: firstWritable,
            responseCharacteristic: firstNotifiable,
            responseCccd: firstNotifiable.descriptors[0],
        });
    });
});
