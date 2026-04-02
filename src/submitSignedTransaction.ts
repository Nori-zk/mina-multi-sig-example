import { Mina, PrivateKey, type NetworkId } from 'o1js';

export type SubmitConfig = {
    networkUrl: string;
    networkId: NetworkId;
    feePayerKey: PrivateKey;
    fee: number;
};

export async function submitSignedTransaction(
    signedTxJson: string,
    config: SubmitConfig
): Promise<string> {
    const { networkUrl, networkId, feePayerKey, fee } = config;

    const Network = Mina.Network({ networkId, mina: networkUrl });
    Mina.setActiveInstance(Network);

    const tx = Mina.Transaction.fromJSON(signedTxJson);
    const signedTx = tx.sign([feePayerKey]);

    const pendingTx = await signedTx.send();
    await pendingTx.wait();

    return pendingTx.hash;
}
