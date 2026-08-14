/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

/* eslint-disable import/first */

jest.mock('../../utils/uuid_definitions', () => ({
    getUuidName: value => value,
}));

import { shallow } from 'enzyme';
import { List } from 'immutable';
import React from 'react';

import { getImmutableDevice } from '../../utils/api';
import DiscoveredDevice from '../DiscoveredDevice';

const manufacturerData =
    '76,0,2,21,0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255,81,35,69,103,197';

function renderDevice(gldVersion) {
    const device = getImmutableDevice({
        address: 'AA:BB:CC:DD:EE:FF',
        addressType: 'BLE_GAP_ADDR_TYPE_PUBLIC',
        name: 'GLD beacon',
        rssi: -65,
        adData: {
            BLE_GAP_AD_TYPE_MANUFACTURER_SPECIFIC_DATA: manufacturerData,
        },
    })
        .set('isExpanded', true)
        .set('allRssi', List([-65]));

    return shallow(
        <DiscoveredDevice
            device={device}
            adapterIsConnecting={false}
            isConnecting={false}
            gldVersion={gldVersion}
            onConnect={() => {}}
            onCancelConnect={() => {}}
            onToggleExpanded={() => {}}
        />
    );
}

describe('DiscoveredDevice', () => {
    it('shows iBeacon Major and Minor when GLD mode is disabled', () => {
        const wrapper = renderDevice(false);

        expect(wrapper.text()).toContain('Major:20771');
        expect(wrapper.text()).toContain('Minor:17767');
    });

    it('shows decoded GLD fields when GLD mode is enabled', () => {
        const wrapper = renderDevice(true);

        expect(wrapper.text()).toContain('Battery level:5');
        expect(wrapper.text()).toContain('Serial number:19088743');
        expect(wrapper.text()).not.toContain('Major:20771');
        expect(wrapper.text()).not.toContain('Minor:17767');
    });
});
