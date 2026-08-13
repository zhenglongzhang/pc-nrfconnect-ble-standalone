/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

/* eslint no-bitwise: off */

/*
 * iBeacon configuration protocol shared with znzl_beacn.
 *
 * Frame: A1 | payload length | command/result payload | CRC-8/MAXIM
 */

export const IBEACON_COMMAND = {
    PASSWORD_CHECK: 'PASSWORD_CHECK',
    PASSWORD_SET: 'PASSWORD_SET',
    UUID_SET: 'UUID_SET',
    MAJOR_SET: 'MAJOR_SET',
    MINOR_SET: 'MINOR_SET',
    RSSI_SET: 'RSSI_SET',
    TX_POWER_SET: 'TX_POWER_SET',
    BROADCAST_INTERVAL_SET: 'BROADCAST_INTERVAL_SET',
};

const COMMAND_CODE = {
    [IBEACON_COMMAND.PASSWORD_CHECK]: 0xe0,
    [IBEACON_COMMAND.PASSWORD_SET]: 0xe1,
    [IBEACON_COMMAND.UUID_SET]: 0xf1,
    [IBEACON_COMMAND.MAJOR_SET]: 0xf2,
    [IBEACON_COMMAND.MINOR_SET]: 0xf3,
    [IBEACON_COMMAND.RSSI_SET]: 0xf4,
    [IBEACON_COMMAND.TX_POWER_SET]: 0xf5,
    [IBEACON_COMMAND.BROADCAST_INTERVAL_SET]: 0xf6,
};

const CODE_COMMAND = Object.keys(COMMAND_CODE).reduce(
    (commands, command) => ({ ...commands, [COMMAND_CODE[command]]: command }),
    {}
);

function crc8Maxim(bytes) {
    return bytes.reduce((crc, byte) => {
        let nextCrc = crc ^ byte;
        for (let bit = 0; bit < 8; bit += 1) {
            nextCrc = nextCrc & 0x01 ? (nextCrc >>> 1) ^ 0x8c : nextCrc >>> 1;
        }
        return nextCrc;
    }, 0);
}

function parseInteger(value, label, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(
            `${label} must be an integer between ${minimum} and ${maximum}.`
        );
    }
    return parsed;
}

function uint16(value) {
    return [(value >>> 8) & 0xff, value & 0xff];
}

function int8(value) {
    return value < 0 ? value + 0x100 : value;
}

function getPayload(command, value) {
    switch (command) {
        case IBEACON_COMMAND.PASSWORD_CHECK:
        case IBEACON_COMMAND.PASSWORD_SET: {
            const password = parseInteger(value, 'Password', 0, 0xffffffff);
            return [
                (password >>> 24) & 0xff,
                (password >>> 16) & 0xff,
                (password >>> 8) & 0xff,
                password & 0xff,
            ];
        }
        case IBEACON_COMMAND.UUID_SET: {
            const normalized = String(value).replace(/-/g, '');
            if (!/^[0-9a-fA-F]{32}$/.test(normalized)) {
                throw new Error(
                    'UUID must contain exactly 32 hexadecimal characters.'
                );
            }
            return normalized.match(/.{2}/g).map(part => parseInt(part, 16));
        }
        case IBEACON_COMMAND.MAJOR_SET:
            return uint16(parseInteger(value, 'Major', 0, 65535));
        case IBEACON_COMMAND.MINOR_SET:
            return uint16(parseInteger(value, 'Minor', 0, 65535));
        case IBEACON_COMMAND.RSSI_SET:
            return [int8(parseInteger(value, 'RSSI at 1m', -127, 0))];
        case IBEACON_COMMAND.TX_POWER_SET:
            return [int8(parseInteger(value, 'Transmit power', -128, 127))];
        case IBEACON_COMMAND.BROADCAST_INTERVAL_SET: {
            const interval = Number(value);
            const units = interval / 0.625;
            if (
                !Number.isFinite(interval) ||
                interval <= 0 ||
                units > 65535 ||
                !Number.isInteger(units)
            ) {
                throw new Error(
                    'Broadcast interval must be a positive multiple of 0.625 ms within the protocol range.'
                );
            }
            return uint16(units);
        }
        default:
            throw new Error(`Unsupported iBeacon command: ${command}`);
    }
}

export function createIbeaconCommand(command, value) {
    const commandCode = COMMAND_CODE[command];
    if (commandCode === undefined) {
        throw new Error(`Unsupported iBeacon command: ${command}`);
    }

    const payload = [commandCode, ...getPayload(command, value)];
    const frame = [0xa1, payload.length, ...payload];
    return [...frame, crc8Maxim(frame)];
}

export function findIbeaconConfigurationAttributes(characteristics) {
    const writeCharacteristic = characteristics.find(
        characteristic =>
            characteristic.properties &&
            characteristic.properties.write === true
    );
    const responseCharacteristic = characteristics.find(
        characteristic =>
            characteristic.properties &&
            characteristic.properties.notify === true &&
            Array.isArray(characteristic.descriptors) &&
            characteristic.descriptors.some(
                descriptor => descriptor.uuid === '2902'
            )
    );

    if (!writeCharacteristic || !responseCharacteristic) {
        throw new Error(
            'The device must expose a write-with-response characteristic and a notifying characteristic with a CCCD.'
        );
    }

    return {
        writeCharacteristic,
        responseCharacteristic,
        responseCccd: responseCharacteristic.descriptors.find(
            descriptor => descriptor.uuid === '2902'
        ),
    };
}

export function shouldWriteIbeaconCommandWithResponse(characteristic) {
    return Boolean(
        characteristic &&
            characteristic.properties &&
            characteristic.properties.write === true
    );
}

export function attachIbeaconDescriptors(characteristic, descriptors) {
    return {
        instanceId: characteristic.instanceId,
        serviceInstanceId: characteristic.serviceInstanceId,
        uuid: characteristic.uuid,
        properties: characteristic.properties,
        descriptors,
    };
}

function signedByte(byte) {
    return byte > 0x7f ? byte - 0x100 : byte;
}

export function parseIbeaconResponse(value) {
    const frame = Array.from(value || []);
    if (frame.length < 4 || frame[0] !== 0xa1) {
        throw new Error('Invalid iBeacon response frame.');
    }

    const payloadLength = frame[1];
    if (frame.length !== payloadLength + 3) {
        throw new Error('iBeacon response length does not match its payload.');
    }

    const expectedCrc = crc8Maxim(frame.slice(0, -1));
    if (frame[frame.length - 1] !== expectedCrc) {
        throw new Error('iBeacon response CRC is invalid.');
    }

    const command = CODE_COMMAND[frame[2]];
    if (!command || payloadLength < 2) {
        throw new Error('Unknown iBeacon response command.');
    }

    const data = frame.slice(4, -1);
    const response = { command, success: frame[3] === 0x00, values: {} };

    if (!response.success) {
        return response;
    }

    if (command === IBEACON_COMMAND.UUID_SET && data.length >= 16) {
        response.values.uuid = data
            .slice(0, 16)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase();
    } else if (
        (command === IBEACON_COMMAND.MAJOR_SET ||
            command === IBEACON_COMMAND.MINOR_SET) &&
        data.length >= 4
    ) {
        response.values.major = (data[0] << 8) | data[1];
        response.values.minor = (data[2] << 8) | data[3];
    } else if (command === IBEACON_COMMAND.RSSI_SET && data.length >= 1) {
        response.values.rssiAt1m = signedByte(data[0]);
    } else if (command === IBEACON_COMMAND.TX_POWER_SET && data.length >= 1) {
        response.values.txPower = signedByte(data[0]);
    } else if (
        command === IBEACON_COMMAND.BROADCAST_INTERVAL_SET &&
        data.length >= 2
    ) {
        response.values.broadcastInterval = ((data[0] << 8) | data[1]) * 0.625;
    }

    return response;
}
