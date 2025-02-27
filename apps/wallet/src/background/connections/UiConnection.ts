// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { BehaviorSubject, filter, switchMap, takeUntil } from 'rxjs';

import { Connection } from './Connection';
import { createMessage } from '_messages';
import {
    isGetPermissionRequests,
    isPermissionResponse,
} from '_payloads/permissions';
import { isGetTransactionRequests } from '_payloads/transactions/ui/GetTransactionRequests';
import { isTransactionRequestResponse } from '_payloads/transactions/ui/TransactionRequestResponse';
import Permissions from '_src/background/Permissions';
import Tabs from '_src/background/Tabs';
import Transactions from '_src/background/Transactions';
import { isDisconnectApp } from '_src/shared/messaging/messages/payloads/permissions/DisconnectApp';

import type { Message } from '_messages';
import type { PortChannelName } from '_messaging/PortChannelName';
import type { Permission, PermissionRequests } from '_payloads/permissions';
import type { UpdateActiveOrigin } from '_payloads/tabs/updateActiveOrigin';
import type { TransactionRequest } from '_payloads/transactions';
import type { GetTransactionRequestsResponse } from '_payloads/transactions/ui/GetTransactionRequestsResponse';
import type { Runtime } from 'webextension-polyfill';

export class UiConnection extends Connection {
    public static readonly CHANNEL: PortChannelName = 'sui_ui<->background';
    private uiAppInitialized: BehaviorSubject<boolean> = new BehaviorSubject(
        false
    );

    constructor(port: Runtime.Port) {
        super(port);
        this.uiAppInitialized
            .pipe(
                filter((init) => init),
                switchMap(() => Tabs.activeOrigin),
                takeUntil(this.onDisconnect)
            )
            .subscribe(({ origin, favIcon }) => {
                this.send(
                    createMessage<UpdateActiveOrigin>({
                        type: 'update-active-origin',
                        origin,
                        favIcon,
                    })
                );
            });
    }

    protected async handleMessage(msg: Message) {
        const { payload, id } = msg;
        if (isGetPermissionRequests(payload)) {
            this.sendPermissions(
                Object.values(await Permissions.getPermissions()),
                id
            );
            // TODO: we should depend on a better message to know if app is initialized
            if (!this.uiAppInitialized.value) {
                this.uiAppInitialized.next(true);
            }
        } else if (isPermissionResponse(payload)) {
            Permissions.handlePermissionResponse(payload);
        } else if (isTransactionRequestResponse(payload)) {
            Transactions.handleMessage(payload);
        } else if (isGetTransactionRequests(payload)) {
            this.sendTransactionRequests(
                Object.values(await Transactions.getTransactionRequests()),
                id
            );
        } else if (isDisconnectApp(payload)) {
            await Permissions.delete(payload.origin);
            this.send(createMessage({ type: 'done' }, id));
        }
    }

    private sendPermissions(permissions: Permission[], requestID: string) {
        this.send(
            createMessage<PermissionRequests>(
                {
                    type: 'permission-request',
                    permissions,
                },
                requestID
            )
        );
    }

    private sendTransactionRequests(
        txRequests: TransactionRequest[],
        requestID: string
    ) {
        this.send(
            createMessage<GetTransactionRequestsResponse>(
                {
                    type: 'get-transaction-requests-response',
                    txRequests,
                },
                requestID
            )
        );
    }
}
