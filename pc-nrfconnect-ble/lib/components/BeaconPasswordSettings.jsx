/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useRef, useState } from 'react';
import Form from 'react-bootstrap/Form';

import { persistentStore } from '../common/Persistentstore';
import { isValidBeaconPassword } from '../utils/beaconPassword';

export default function BeaconPasswordSettings() {
    const [password, setPassword] = useState(persistentStore.beaconPassword);
    const [message, setMessage] = useState('');
    const [error, setError] = useState(false);
    const saveTimeout = useRef(null);

    useEffect(() => () => clearTimeout(saveTimeout.current), []);

    const updatePassword = event => {
        const { value } = event.target;
        clearTimeout(saveTimeout.current);
        setPassword(value);
        if (!isValidBeaconPassword(value)) {
            setError(true);
            setMessage('请输入至少 6 位数字密码，数值不能超过 4294967295。');
            return;
        }
        setError(false);
        setMessage('停止输入 2 秒后自动保存…');
        saveTimeout.current = setTimeout(() => {
            saveTimeout.current = null;
            try {
                persistentStore.setBeaconPassword(value);
                setError(false);
                setMessage(
                    '已保存，下次进入 Beacon configuration 时自动验证。'
                );
            } catch (saveError) {
                setError(true);
                setMessage(`保存失败：${saveError.message}`);
            }
        }, 2000);
    };

    return (
        <Form.Group controlId="beaconDefaultPassword">
            <Form.Label>连接默认密码</Form.Label>
            <Form.Control
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={password}
                onChange={updatePassword}
            />
            <Form.Text>
                初始为 999999，输入至少 6 位有效数字，停止输入 2 秒后自动保存。
            </Form.Text>
            {message && (
                <Form.Text
                    className={error ? 'text-danger' : 'text-success'}
                    role="status"
                >
                    {message}
                </Form.Text>
            )}
        </Form.Group>
    );
}
