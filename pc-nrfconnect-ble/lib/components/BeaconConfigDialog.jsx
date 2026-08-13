/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

/* eslint
    class-methods-use-this: off,
    react/destructuring-assignment: off,
    react/forbid-prop-types: off,
    react/no-access-state-in-setstate: off,
    react/no-did-update-set-state: off
*/

import React from 'react';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import { logger } from 'pc-nrfconnect-shared';
import PropTypes from 'prop-types';

import { getInstanceIds } from '../utils/api';
import { appendDeviceParametersToCsv } from '../utils/appendToCsv';
import {
    createIbeaconCommand,
    getIbeaconValuesFromDevice,
    IBEACON_COMMAND,
    parseIbeaconResponse,
} from '../utils/ibeaconProtocol';
import { toHexString } from '../utils/stringUtil';

const TX_POWER_OPTIONS = [-40, -20, -16, -12, -8, -4, 0, 4];
const INTERVAL_OPTIONS = [
    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 2500, 3000,
    5000, 10000,
];
export const DEFAULT_IBEACON_PASSWORD = '123456';

export function getCharacteristicValue(deviceDetails, instanceId) {
    if (!deviceDetails || !instanceId) {
        return null;
    }
    const ids = getInstanceIds(instanceId);
    const device = deviceDetails.devices.get(ids.device);
    const service =
        device && device.children && device.children.get(ids.service);
    const characteristic =
        service && service.children && service.children.get(ids.characteristic);
    if (!characteristic || !characteristic.value) {
        return null;
    }

    const { value } = characteristic;
    const valueForDevice =
        typeof value.get === 'function' && value.get(ids.device);
    return (valueForDevice || value).toArray();
}

export class BeaconConfigDialog extends React.PureComponent {
    constructor(props) {
        super(props);
        this.state = this.initialState();
        this.timeout = null;
        this.prepare = this.prepare.bind(this);
        this.send = this.send.bind(this);
        this.handleResponse = this.handleResponse.bind(this);
    }

    componentDidMount() {
        this.prepare();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.device.instanceId !== this.props.device.instanceId) {
            this.clearTimeout();
            this.setState(this.initialState(), this.prepare);
            return;
        }

        const { responseInstanceId } = this.state;
        if (!responseInstanceId || !this.state.pendingCommand) {
            return;
        }
        const previous = getCharacteristicValue(
            prevProps.deviceDetails,
            responseInstanceId
        );
        const current = getCharacteristicValue(
            this.props.deviceDetails,
            responseInstanceId
        );
        if (current && JSON.stringify(current) !== JSON.stringify(previous)) {
            this.handleResponse(current);
        }
    }

    componentWillUnmount() {
        this.clearTimeout();
    }

    initialState() {
        return {
            configuration: null,
            pendingCommand: null,
            responseInstanceId: null,
            verified: false,
            passwordRequired: false,
            status: 'Preparing iBeacon configuration…',
            statusType: 'info',
            values: {
                password: '',
                newPassword: '',
                uuid: '',
                major: '',
                minor: '',
                rssiAt1m: '',
                txPower: '0',
                broadcastInterval: '100',
            },
        };
    }

    clearTimeout() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }

    async prepare() {
        const { device, onPrepare, scannedDevice } = this.props;
        try {
            const configuration = await onPrepare(device);
            const prefillSource = scannedDevice || device;
            const scannedValues = getIbeaconValuesFromDevice(prefillSource);
            logger.info(
                `[iBeacon] ready device=${device.instanceId} write=${configuration.writeCharacteristic.instanceId} notify=${configuration.responseCharacteristic.instanceId}`
            );
            logger.info(
                `[iBeacon] prefill source=${
                    scannedDevice ? 'scan-cache' : 'connected-device'
                } address=${device.address} values=${JSON.stringify(
                    scannedValues
                )}`
            );
            this.setState(
                {
                    configuration,
                    responseInstanceId:
                        configuration.responseCharacteristic.instanceId,
                    values: {
                        ...this.state.values,
                        ...scannedValues,
                        password: DEFAULT_IBEACON_PASSWORD,
                    },
                    status: 'Notifications enabled. Verifying the default password…',
                    statusType: 'info',
                },
                () =>
                    this.send(
                        IBEACON_COMMAND.PASSWORD_CHECK,
                        DEFAULT_IBEACON_PASSWORD
                    )
            );
        } catch (error) {
            this.setState({ status: error.message, statusType: 'danger' });
        }
    }

    updateValue(name, event) {
        const { values } = this.state;
        this.setState({ values: { ...values, [name]: event.target.value } });
    }

    send(command, value) {
        const { onWriteCharacteristic } = this.props;
        const { configuration, pendingCommand } = this.state;
        if (!configuration || pendingCommand) {
            return;
        }

        let frame;
        try {
            frame = createIbeaconCommand(command, value);
        } catch (error) {
            this.setState({ status: error.message, statusType: 'danger' });
            return;
        }

        this.setState({
            pendingCommand: command,
            status: 'Command sent; waiting for device response…',
            statusType: 'info',
        });
        this.timeout = setTimeout(() => {
            logger.warn(
                `[iBeacon] response timeout command=${command} notify=${configuration.responseCharacteristic.instanceId}`
            );
            this.setState({
                pendingCommand: null,
                passwordRequired: command === IBEACON_COMMAND.PASSWORD_CHECK,
                status:
                    command === IBEACON_COMMAND.PASSWORD_CHECK
                        ? 'Default password verification timed out. Enter the device password and try again.'
                        : 'The device did not respond within 5 seconds.',
                statusType: 'danger',
            });
        }, 5000);

        logger.debug(
            `[iBeacon] command send command=${command} write=${
                configuration.writeCharacteristic.instanceId
            } data=${toHexString(frame)}`
        );
        onWriteCharacteristic(configuration.writeCharacteristic, frame);
    }

    handleResponse(value) {
        const { pendingCommand, values } = this.state;
        let response;
        try {
            response = parseIbeaconResponse(value);
        } catch (error) {
            logger.warn(
                `[iBeacon] response ignored reason=${
                    error.message
                } data=${toHexString(value)}`
            );
            return;
        }
        if (response.command !== pendingCommand) {
            logger.warn(
                `[iBeacon] response ignored expected=${pendingCommand} actual=${
                    response.command
                } data=${toHexString(value)}`
            );
            return;
        }

        logger.info(
            `[iBeacon] response received command=${response.command} success=${
                response.success
            } data=${toHexString(value)}`
        );
        this.clearTimeout();
        if (!response.success) {
            this.setState({
                pendingCommand: null,
                passwordRequired:
                    response.command === IBEACON_COMMAND.PASSWORD_CHECK,
                values:
                    response.command === IBEACON_COMMAND.PASSWORD_CHECK
                        ? { ...values, password: '' }
                        : values,
                status:
                    response.command === IBEACON_COMMAND.PASSWORD_CHECK
                        ? 'Default password was rejected. Enter the device password and try again.'
                        : 'The device rejected the command.',
                statusType: 'danger',
            });
            return;
        }

        const nextValues = { ...values };
        if (response.values.uuid !== undefined)
            nextValues.uuid = response.values.uuid;
        if (response.values.major !== undefined)
            nextValues.major = String(response.values.major);
        if (response.values.minor !== undefined)
            nextValues.minor = String(response.values.minor);
        if (response.values.rssiAt1m !== undefined) {
            nextValues.rssiAt1m = String(response.values.rssiAt1m);
        }
        if (response.values.txPower !== undefined) {
            nextValues.txPower = String(response.values.txPower);
        }
        if (response.values.broadcastInterval !== undefined) {
            nextValues.broadcastInterval = String(
                response.values.broadcastInterval
            );
        }

        if (
            response.command !== IBEACON_COMMAND.PASSWORD_CHECK &&
            response.command !== IBEACON_COMMAND.PASSWORD_SET
        ) {
            try {
                const csvPath = appendDeviceParametersToCsv({
                    mac: this.props.device.address,
                    uuid: nextValues.uuid,
                    major: nextValues.major,
                    minor: nextValues.minor,
                    rssiAt1m: nextValues.rssiAt1m,
                    txPower: nextValues.txPower,
                    broadcastInterval: nextValues.broadcastInterval,
                });
                logger.info(`[iBeacon] parameter log appended path=${csvPath}`);
            } catch (error) {
                logger.warn(
                    `[iBeacon] parameter log failed reason=${error.message}`
                );
            }
        }

        this.setState({
            pendingCommand: null,
            verified:
                this.state.verified ||
                response.command === IBEACON_COMMAND.PASSWORD_CHECK,
            passwordRequired: false,
            values: nextValues,
            status: 'Configuration updated successfully.',
            statusType: 'success',
        });
    }

    renderField(label, name, command, disabled, type = 'text') {
        const { values, pendingCommand } = this.state;
        return (
            <Form.Group>
                <Form.Label>{label}</Form.Label>
                <div className="d-flex">
                    <Form.Control
                        type={type}
                        value={values[name]}
                        disabled={disabled || !!pendingCommand}
                        onChange={event => this.updateValue(name, event)}
                    />
                    <Button
                        className="ml-2"
                        disabled={disabled || !!pendingCommand}
                        onClick={() => this.send(command, values[name])}
                    >
                        Set
                    </Button>
                </div>
            </Form.Group>
        );
    }

    renderSelect(label, name, command, options) {
        const { values, verified, pendingCommand } = this.state;
        return (
            <Form.Group>
                <Form.Label>{label}</Form.Label>
                <div className="d-flex">
                    <Form.Control
                        as="select"
                        value={values[name]}
                        disabled={!verified || !!pendingCommand}
                        onChange={event => this.updateValue(name, event)}
                    >
                        {options.map(option => (
                            <option key={option} value={option}>
                                {option} {name === 'txPower' ? 'dBm' : 'ms'}
                            </option>
                        ))}
                    </Form.Control>
                    <Button
                        className="ml-2"
                        disabled={!verified || !!pendingCommand}
                        onClick={() => this.send(command, values[name])}
                    >
                        Set
                    </Button>
                </div>
            </Form.Group>
        );
    }

    render() {
        const { device, onHide } = this.props;
        const { pendingCommand, status, statusType, verified } = this.state;
        return (
            <Modal show onHide={onHide} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>
                        Beacon configuration — {device.address}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className={`alert alert-${statusType}`} role="alert">
                        {status}
                    </div>
                    {this.state.passwordRequired &&
                        this.renderField(
                            'Password',
                            'password',
                            IBEACON_COMMAND.PASSWORD_CHECK,
                            false,
                            'password'
                        )}
                    {this.renderField(
                        'New password',
                        'newPassword',
                        IBEACON_COMMAND.PASSWORD_SET,
                        !verified,
                        'password'
                    )}
                    {this.renderField(
                        'UUID',
                        'uuid',
                        IBEACON_COMMAND.UUID_SET,
                        !verified
                    )}
                    {this.renderField(
                        'Major',
                        'major',
                        IBEACON_COMMAND.MAJOR_SET,
                        !verified
                    )}
                    {this.renderField(
                        'Minor',
                        'minor',
                        IBEACON_COMMAND.MINOR_SET,
                        !verified
                    )}
                    {this.renderField(
                        'RSSI at 1 m (dBm)',
                        'rssiAt1m',
                        IBEACON_COMMAND.RSSI_SET,
                        !verified,
                        'number'
                    )}
                    {this.renderSelect(
                        'Transmit power',
                        'txPower',
                        IBEACON_COMMAND.TX_POWER_SET,
                        TX_POWER_OPTIONS
                    )}
                    {this.renderSelect(
                        'Broadcast interval',
                        'broadcastInterval',
                        IBEACON_COMMAND.BROADCAST_INTERVAL_SET,
                        INTERVAL_OPTIONS
                    )}
                    {pendingCommand && <div>Waiting for {pendingCommand}…</div>}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={onHide}>
                        Close
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

BeaconConfigDialog.propTypes = {
    device: PropTypes.object.isRequired,
    deviceDetails: PropTypes.object,
    onHide: PropTypes.func.isRequired,
    onPrepare: PropTypes.func.isRequired,
    onWriteCharacteristic: PropTypes.func.isRequired,
    scannedDevice: PropTypes.object,
};

BeaconConfigDialog.defaultProps = {
    deviceDetails: null,
    scannedDevice: null,
};

export default BeaconConfigDialog;
