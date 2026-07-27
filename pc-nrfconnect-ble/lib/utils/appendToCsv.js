/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import fs from 'fs';
import path from 'path';
import {
    getAppLogDir,
    getUserDataDir,
    logger,
    setAppDirs,
} from 'pc-nrfconnect-shared';

export const appendToCsv = data => {
    // getAppLogDir() /Users/zhenglongzhang/Library/Application Support/nrfconnect-bluetooth-low-energy/bundle/logs
    // 需要往上一层的csvs目录下写入
    const appDataDir = path.join(getAppLogDir(), '..', 'csvs');
    const today = new Date();
    const fileName = `${today.getFullYear()}-${String(
        today.getMonth() + 1
    ).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.csv`;
    const csvPath = path.join(appDataDir, fileName);
    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, '时间,平均值,最大值,最小值,Mac\n');
        fs.appendFileSync(
            csvPath,
            `${getCurrentTime()},${data.avg},${data.max},${data.min},${
                data.mac
            }\n`
        );
    } else {
        fs.appendFileSync(
            csvPath,
            `${getCurrentTime()},${data.avg},${data.max},${data.min},${
                data.mac
            }\n`
        );
    }
};

const getCurrentTime = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};
