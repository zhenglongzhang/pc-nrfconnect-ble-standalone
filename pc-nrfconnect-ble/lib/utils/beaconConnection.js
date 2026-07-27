/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

export function findNewConnectedDevice(previousDevices, connectedDevices) {
    if (!connectedDevices) {
        return null;
    }

    return (
        connectedDevices.find(
            (device, instanceId) =>
                !previousDevices || !previousDevices.has(instanceId)
        ) || null
    );
}
