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

import { persistentStore } from '../common/Persistentstore';
import { getInstanceIds } from '../utils/api';
import { appendDeviceParametersToCsv } from '../utils/appendToCsv';
import { isValidBeaconPassword } from '../utils/beaconPassword';
import {
    createIbeaconCommand,
    decodeGldBroadcastData,
    encodeGldBroadcastData,
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
export { DEFAULT_IBEACON_PASSWORD } from '../utils/beaconPassword';

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
        this.passwordTimeout = null;
        this.closed = false;
        this.prepareRequest = 0;
        this.passwordInput = React.createRef();
        this.scannerInput = React.createRef();
        this.prepare = this.prepare.bind(this);
        this.send = this.send.bind(this);
        this.submitGldSerialNumber = this.submitGldSerialNumber.bind(this);
        this.submitScannerInput = this.submitScannerInput.bind(this);
        this.handleResponse = this.handleResponse.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.focusInput = this.focusInput.bind(this);
    }

    componentDidMount() {
        this.prepare();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.device.instanceId !== this.props.device.instanceId) {
            this.clearTimeout();
            this.clearPasswordTimeout();
            this.prepareRequest += 1;
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
        this.closed = true;
        this.prepareRequest += 1;
        this.clearTimeout();
        this.clearPasswordTimeout();
    }

    initialState() {
        return {
            configuration: null,
            pendingCommand: null,
            pairWrite: null,
            responseInstanceId: null,
            verified: false,
            passwordRequired: false,
            status: 'Preparing iBeacon configuration…',
            statusType: 'info',
            scannerInput: '',
            values: {
                password: '',
                newPassword: '',
                uuid: '',
                major: '',
                minor: '',
                serialNumber: '',
                batteryLevel: '',
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

    clearPasswordTimeout() {
        clearTimeout(this.passwordTimeout);
        this.passwordTimeout = null;
    }

    focusInput() {
        if (this.closed || this.state.pendingCommand) return;
        const input = this.state.verified
            ? this.scannerInput.current
            : this.passwordInput.current;
        if (input) input.focus();
    }

    handleClose() {
        if (this.closed) return;
        this.closed = true;
        this.prepareRequest += 1;
        this.clearTimeout();
        this.clearPasswordTimeout();
        const { device, onDisconnect, onHide } = this.props;
        try {
            onDisconnect(device);
        } finally {
            onHide();
        }
    }

    async prepare() {
        if (this.closed) return;
        this.prepareRequest += 1;
        const request = this.prepareRequest;
        const { device, onPrepare, scannedDevice } = this.props;
        try {
            const configuration = await onPrepare(device);
            if (this.closed || request !== this.prepareRequest) return;
            const password = persistentStore.beaconPassword();
            const prefillSource = scannedDevice || device;
            const scannedValues = getIbeaconValuesFromDevice(prefillSource);
            const gldData = decodeGldBroadcastData(
                Number(scannedValues.major),
                Number(scannedValues.minor)
            );
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
                        ...(gldData.isValid
                            ? {
                                  serialNumber: String(gldData.serialNumber),
                                  batteryLevel: String(gldData.batteryLevel),
                              }
                            : {}),
                        password,
                    },
                    status: 'Notifications enabled. Verifying the default password…',
                    statusType: 'info',
                },
                () => this.send(IBEACON_COMMAND.PASSWORD_CHECK, password)
            );
        } catch (error) {
            if (this.closed || request !== this.prepareRequest) return;
            this.setState({ status: error.message, statusType: 'danger' });
        }
    }

    updateValue(name, event) {
        const { values } = this.state;
        const { value } = event.target;
        this.setState({ values: { ...values, [name]: value } });
        if (name === 'password') {
            this.clearPasswordTimeout();
            if (this.state.passwordRequired && isValidBeaconPassword(value)) {
                this.passwordTimeout = setTimeout(() => {
                    this.passwordTimeout = null;
                    if (!this.state.verified) {
                        this.send(IBEACON_COMMAND.PASSWORD_CHECK, value);
                    }
                }, 2000);
            }
        }
    }

    startPairWrite(major, minor, values) {
        this.setState(
            {
                values: { ...this.state.values, ...values },
                pairWrite: { minor: String(minor) },
            },
            () => this.send(IBEACON_COMMAND.MAJOR_SET, String(major))
        );
    }

    submitGldSerialNumber(serialNumber = this.state.values.serialNumber) {
        const { batteryLevel } = this.state.values;
        const encoded = encodeGldBroadcastData(
            Number(serialNumber),
            Number(batteryLevel)
        );
        if (!encoded.isValid) {
            this.setState({
                status: 'SN or battery level is invalid.',
                statusType: 'danger',
            });
            return;
        }

        this.startPairWrite(encoded.major, encoded.minor, {
            major: String(encoded.major),
            minor: String(encoded.minor),
            serialNumber: String(serialNumber),
        });
    }

    submitScannerInput() {
        const { gldVersion } = this.props;
        const { pendingCommand, verified, scannerInput } = this.state;
        const payload = scannerInput.trim();
        if (!verified || pendingCommand) {
            return;
        }

        const majorMinor = payload.match(/^(\d+),(\d+)$/);
        if (majorMinor) {
            const major = Number(majorMinor[1]);
            const minor = Number(majorMinor[2]);
            if (major > 65535 || minor > 65535) {
                this.setState({
                    status: 'Major and Minor must be integers between 0 and 65535.',
                    statusType: 'danger',
                });
                return;
            }
            this.setState({ scannerInput: '' });
            this.startPairWrite(major, minor, {
                major: String(major),
                minor: String(minor),
            });
            return;
        }

        if (!/^\d+$/.test(payload)) {
            this.setState({
                status: 'Scanner data must be Major,Minor or a GLD SN.',
                statusType: 'danger',
            });
            return;
        }
        if (!gldVersion) {
            this.setState({
                status: 'Enable GLD version before submitting an SN.',
                statusType: 'danger',
            });
            return;
        }
        if (payload.length !== 9) {
            this.setState({
                status: 'GLD SN scanner data must contain exactly 9 digits.',
                statusType: 'danger',
            });
            return;
        }
        this.setState({ scannerInput: '' });
        this.submitGldSerialNumber(payload);
    }

    send(command, value) {
        const { onWriteCharacteristic } = this.props;
        const { configuration, pendingCommand } = this.state;
        if (this.closed || !configuration || pendingCommand) {
            return;
        }

        if (command === IBEACON_COMMAND.PASSWORD_CHECK) {
            this.clearPasswordTimeout();
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
            this.setState(
                {
                    pendingCommand: null,
                    pairWrite: null,
                    passwordRequired:
                        command === IBEACON_COMMAND.PASSWORD_CHECK,
                    status:
                        command === IBEACON_COMMAND.PASSWORD_CHECK
                            ? 'Default password verification timed out. Enter the device password and try again.'
                            : 'The device did not respond within 5 seconds.',
                    statusType: 'danger',
                },
                this.focusInput
            );
        }, 5000);

        logger.debug(
            `[iBeacon] command send command=${command} write=${
                configuration.writeCharacteristic.instanceId
            } data=${toHexString(frame)}`
        );
        onWriteCharacteristic(configuration.writeCharacteristic, frame);
    }

    handleResponse(value) {
        if (this.closed) return;
        const { pendingCommand, pairWrite, values } = this.state;
        const { gldVersion } = this.props;
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
            this.setState(
                {
                    pendingCommand: null,
                    pairWrite: null,
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
                },
                this.focusInput
            );
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

        if (response.command === IBEACON_COMMAND.MAJOR_SET && pairWrite) {
            this.setState({ pendingCommand: null, values: nextValues }, () =>
                this.send(IBEACON_COMMAND.MINOR_SET, pairWrite.minor)
            );
            return;
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
                    gldVersion,
                });
                logger.info(`[iBeacon] parameter log appended path=${csvPath}`);
            } catch (error) {
                logger.warn(
                    `[iBeacon] parameter log failed reason=${error.message}`
                );
            }
        }

        this.setState(
            {
                pendingCommand: null,
                pairWrite:
                    response.command === IBEACON_COMMAND.MINOR_SET && pairWrite
                        ? null
                        : pairWrite,
                verified:
                    this.state.verified ||
                    response.command === IBEACON_COMMAND.PASSWORD_CHECK,
                passwordRequired: false,
                values: nextValues,
                status: 'Configuration updated successfully.',
                statusType: 'success',
            },
            response.command === IBEACON_COMMAND.PASSWORD_CHECK
                ? this.focusInput
                : undefined
        );
    }

    renderField(label, name, command, disabled, type = 'text') {
        const { values, pendingCommand } = this.state;
        return (
            <Form.Group>
                <Form.Label>{label}</Form.Label>
                <div className="d-flex">
                    <Form.Control
                        ref={
                            name === 'password' ? this.passwordInput : undefined
                        }
                        aria-label={label}
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
                {name === 'password' && (
                    <Form.Text>
                        输入至少 6 位数字后，停止输入 2 秒自动验证。
                    </Form.Text>
                )}
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

    renderReadOnlyField(label, name) {
        const { values } = this.state;
        return (
            <Form.Group>
                <Form.Label>{label}</Form.Label>
                <Form.Control value={values[name]} readOnly />
            </Form.Group>
        );
    }

    renderGldSerialField() {
        const { values, verified, pendingCommand } = this.state;
        return (
            <Form.Group>
                <Form.Label>SN</Form.Label>
                <div className="d-flex">
                    <Form.Control
                        value={values.serialNumber}
                        disabled={!verified || !!pendingCommand}
                        onChange={event =>
                            this.updateValue('serialNumber', event)
                        }
                    />
                    <Button
                        className="ml-2"
                        disabled={!verified || !!pendingCommand}
                        onClick={this.submitGldSerialNumber}
                    >
                        Set
                    </Button>
                </div>
            </Form.Group>
        );
    }

    render() {
        const { device, gldVersion } = this.props;
        const { pendingCommand, scannerInput, status, statusType, verified } =
            this.state;
        return (
            <Modal
                show
                onHide={this.handleClose}
                onEntered={this.focusInput}
                size="lg"
            >
                <Modal.Header>
                    <Modal.Title>
                        Beacon configuration — {device.address}
                    </Modal.Title>
                    <Button
                        className="ml-3"
                        variant="secondary"
                        onClick={this.handleClose}
                    >
                        Close
                    </Button>
                </Modal.Header>
                <Modal.Body>
                    <div className={`alert alert-${statusType}`} role="alert">
                        {status}
                    </div>
                    <Form.Group>
                        <Form.Label>扫码下发</Form.Label>
                        <div className="d-flex">
                            <Form.Control
                                ref={this.scannerInput}
                                aria-label="扫码下发"
                                value={scannerInput}
                                disabled={!verified || !!pendingCommand}
                                onChange={event =>
                                    this.setState({
                                        scannerInput: event.target.value,
                                    })
                                }
                                onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        this.submitScannerInput();
                                    }
                                }}
                            />
                            <Button
                                className="ml-2"
                                disabled={!verified || !!pendingCommand}
                                onClick={this.submitScannerInput}
                            >
                                扫码下发
                            </Button>
                        </div>
                    </Form.Group>
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
                    {gldVersion ? (
                        <>
                            {this.renderReadOnlyField(
                                'Battery level',
                                'batteryLevel'
                            )}
                            {this.renderGldSerialField()}
                        </>
                    ) : (
                        <>
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
                        </>
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
                    <Button variant="secondary" onClick={this.handleClose}>
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
    onDisconnect: PropTypes.func.isRequired,
    onPrepare: PropTypes.func.isRequired,
    onWriteCharacteristic: PropTypes.func.isRequired,
    scannedDevice: PropTypes.object,
    gldVersion: PropTypes.bool,
};

BeaconConfigDialog.defaultProps = {
    deviceDetails: null,
    scannedDevice: null,
    gldVersion: false,
};

export default BeaconConfigDialog;
