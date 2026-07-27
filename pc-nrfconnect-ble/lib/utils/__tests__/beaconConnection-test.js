/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { OrderedMap } from 'immutable';

import { findNewConnectedDevice } from '../beaconConnection';

describe('findNewConnectedDevice', () => {
    it('returns the device newly added to the connected-device map', () => {
        const device = { instanceId: 'device.1' };

        expect(
            findNewConnectedDevice(
                OrderedMap(),
                OrderedMap([[device.instanceId, device]])
            )
        ).toBe(device);
    });

    it('does not return a device already present in the previous map', () => {
        const device = { instanceId: 'device.1' };
        const devices = OrderedMap([[device.instanceId, device]]);

        expect(findNewConnectedDevice(devices, devices)).toBe(null);
    });
});
