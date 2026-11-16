/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';

import { persistentStore } from '../common/Persistentstore';
import { isValidBeaconPassword } from '../utils/beaconPassword';

export default function BeaconPasswordSettings() {
    const [password, setPassword] = useState(persistentStore.beaconPassword);
    const [message, setMessage] = useState('');
    const [error, setError] = useState(false);

    const save = () => {
        if (!isValidBeaconPassword(password)) {
            setError(true);
            setMessage('请输入至少 6 位数字密码，数值不能超过 4294967295。');
            return;
        }
        try {
            persistentStore.setBeaconPassword(password);
            setError(false);
            setMessage('已保存，下次进入 Beacon configuration 时自动验证。');
        } catch (saveError) {
            setError(true);
            setMessage(`保存失败：${saveError.message}`);
        }
    };

    return (
        <Form.Group controlId="beaconDefaultPassword">
            <Form.Label>连接默认密码</Form.Label>
            <div className="d-flex">
                <Form.Control
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={password}
                    onChange={event => {
                        setPassword(event.target.value);
                        setMessage('');
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            save();
                        }
                    }}
                />
                <Button className="ml-2 text-nowrap" onClick={save}>
                    保存
                </Button>
            </div>
            <Form.Text>初始为 999999，仅用于连接验证。</Form.Text>
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
