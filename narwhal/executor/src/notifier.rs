// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
use crate::{ExecutionIndices, ExecutionState, ExecutorMetrics};
use consensus::ConsensusOutput;
use std::sync::Arc;
use tokio::task::JoinHandle;

use types::{metered_channel, Batch};

#[derive(Clone, Debug)]
pub struct BatchIndex {
    pub consensus_output: Arc<ConsensusOutput>,
    pub next_certificate_index: u64,
    pub batch_index: u64,
}

pub struct Notifier<State: ExecutionState> {
    rx_notifier: metered_channel::Receiver<(BatchIndex, Batch)>,
    callback: State,
    metrics: Arc<ExecutorMetrics>,
}

impl<State: ExecutionState + Send + Sync + 'static> Notifier<State> {
    pub fn spawn(
        rx_notifier: metered_channel::Receiver<(BatchIndex, Batch)>,
        callback: State,
        metrics: Arc<ExecutorMetrics>,
    ) -> JoinHandle<()> {
        let notifier = Notifier {
            rx_notifier,
            callback,
            metrics,
        };
        tokio::spawn(notifier.run())
    }

    async fn run(mut self) {
        while let Some((index, batch)) = self.rx_notifier.recv().await {
            self.metrics.notifier_processed_batches.inc();
            let mut bytes = 0usize;
            for (transaction_index, transaction) in batch.0.into_iter().enumerate() {
                let execution_indices = ExecutionIndices {
                    next_certificate_index: index.next_certificate_index,
                    next_batch_index: index.batch_index + 1,
                    next_transaction_index: transaction_index as u64 + 1,
                };
                bytes += transaction.len();
                self.callback
                    .handle_consensus_transaction(
                        &index.consensus_output,
                        execution_indices,
                        transaction,
                    )
                    .await;
            }
            self.metrics.notifier_processed_bytes.inc_by(bytes as u64);
        }
    }
}
