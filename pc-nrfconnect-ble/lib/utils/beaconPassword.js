/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

export const DEFAULT_IBEACON_PASSWORD = '999999';

export const isValidBeaconPassword = password =>
    /^\d{6,10}$/.test(password) && Number(password) <= 0xffffffff;
