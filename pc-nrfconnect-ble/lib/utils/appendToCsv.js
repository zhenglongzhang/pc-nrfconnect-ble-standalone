/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import fs from 'fs';
import path from 'path';
import { getAppLogDir } from 'pc-nrfconnect-shared';

const CSV_HEADERS = {
    scan: '时间,平均值,最大值,最小值,Mac',
    'device-parameters': 'MAC,MAJ,MIN,TXPWR,ADV间隔,UUID,RssiAt1m,时间戳',
};

function getDateFileName(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        '0'
    )}-${String(date.getDate()).padStart(2, '0')}.csv`;
}

export function getCsvPath(recordType, date = new Date()) {
    return path.join(
        getAppLogDir(),
        '..',
        'csvs',
        recordType,
        getDateFileName(date)
    );
}

function appendRow(recordType, values) {
    const csvPath = getCsvPath(recordType);
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, `${CSV_HEADERS[recordType]}\n`);
    }
    fs.appendFileSync(csvPath, `${values.join(',')}\n`);
}

export function appendScanToCsv({ avg, max, min, mac }) {
    appendRow('scan', [getCurrentTime(), avg, max, min, mac]);
}

export function appendDeviceParametersToCsv({
    mac,
    major = '',
    minor = '',
    txPower = '',
    broadcastInterval = '',
    uuid = '',
    rssiAt1m = '',
}) {
    appendRow('device-parameters', [
        mac,
        major,
        minor,
        txPower,
        broadcastInterval,
        uuid,
        rssiAt1m,
        getCurrentTime(),
    ]);
}

// Kept for existing callers while scan logging migrates to the explicit name.
export const appendToCsv = appendScanToCsv;

function getCurrentTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
