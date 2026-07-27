/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React from 'react';
import { shallow } from 'enzyme';

import { IBEACON_COMMAND } from '../../utils/ibeaconProtocol';
import {
    BeaconConfigDialog,
    DEFAULT_IBEACON_PASSWORD,
} from '../BeaconConfigDialog';

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
});
