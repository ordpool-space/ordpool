import { base64, hex } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { BitcoinNetworkType, signTransaction } from "sats-connect";


export const getUTXOs = async (network, address) => {
  const networkSubpath =
    network === BitcoinNetworkType.Testnet ? "/testnet" : "";
  const url = `https://mempool.space${networkSubpath}/api/address/${address}/utxo`;
  try {
    const response = await fetch(url);
    return response.json();
  } catch (error) {
    console.error(error);
    return null;
  }


};

export const createPSBT = async (
  walletType,
  networkType,
  paymentUnspentOutputs,
  publicKeyHex,
  catRecipient,
  paymentAddress
) => {
  const network = networkType === BitcoinNetworkType.Testnet ? btc.TEST_NETWORK : btc.NETWORK;
  const output = paymentUnspentOutputs[0];

  let scriptInfo;
  if (walletType === "leather") {
    scriptInfo = createInputScriptForLeather(publicKeyHex, network);
  }
  if (walletType === "xverse") {
    scriptInfo = createInputScriptForXverse(publicKeyHex, network);
  }

  const { script, redeemScript } = scriptInfo;

  const lockTime = 21;
  const tx = new btc.Transaction({ allowUnknownOutputs: true, lockTime: lockTime });

  tx.addInput({
    txid: output.txid,
    index: output.vout,
    witnessUtxo: {
      script: script,
      amount: BigInt(output.value),
    },
    redeemScript: redeemScript,
    sighashType: btc.SignatureHash.SINGLE | btc.SignatureHash.ANYONECANPAY,
  });

  // Amounts to send
  const amountToRecipient = 5000n; // Example amount


  // Calculate change
  const totalAmount = BigInt(output.value);
  const changeAmount = totalAmount - amountToRecipient - 10000n;

  if (changeAmount < 0) {
    alert("Insufficient funds for transaction");
    throw new Error("Insufficient funds for transaction");
  }
  console.log("paymentAddress", paymentAddress)
  // Add outputs
  tx.addOutputAddress(catRecipient, amountToRecipient, network);
  tx.addOutputAddress(paymentAddress, changeAmount, network);




  // Generate the base64 encoded PSBT
  const psbt0 = tx.toPSBT(0);
  const psbtB64 = base64.encode(psbt0);
  return psbtB64;
};



function createInputScriptForXverse(publicKeyHex, network) {
  const publicKeyUint8Array = hex.decode(publicKeyHex);
  const p2wpkh = btc.p2wpkh(publicKeyUint8Array, network);
  const p2sh = btc.p2sh(p2wpkh, network);
  return {
    script: p2sh.script,
    redeemScript: p2sh.redeemScript,
  };
}

function createInputScriptForLeather(publicKeyHex, network) {
  console.log("publicKeyHex", publicKeyHex);
  const publicKeyUint8Array = hex.decode(publicKeyHex);
  console.log("publicKeyUint8Array", publicKeyUint8Array);
  const p2wpkh = btc.p2wpkh(publicKeyUint8Array, network);
  console.log("p2wpkh script", p2wpkh.script);
  return {
    script: p2wpkh.script,
    redeemScript: undefined,
  };
}


export const createCat21Transaction = async (walletType, network, ordinalsAddress, paymentAddress, paymentPublicKey) => {
  const paymentUnspentOutputs = await getUTXOs(network, paymentAddress);

  console.log("paymentUnspentOutputs", paymentUnspentOutputs);
  let canContinue = true;

  if (!paymentUnspentOutputs || paymentUnspentOutputs.length === 0) {
    alert(
      "No unspent outputs found for payment address. Load up your wallet's payment address: " +
      paymentAddress
    );
    canContinue = false;
  }

  // Sort UTXOs by value in descending order and select the largest one
  const largestUTXO = paymentUnspentOutputs.sort((a, b) => b.value - a.value)[0];

  if (largestUTXO.value < 20000) {
    alert(
      "Not enough funds in your payment address. Load up your wallet's payment address: " +
      paymentAddress
    );
    canContinue = false;
  }

  if (!canContinue) {
    return;
  }

  const catRecipient = ordinalsAddress;
  const inputAddress = paymentAddress;



  const psbtBase64 = await createPSBT(
    walletType,
    network,
    [largestUTXO], // Use only the largest UTXO
    paymentPublicKey,
    catRecipient,
    inputAddress
  );

  return psbtBase64;

};


export const signTransactionXverse = async (network, psbtBase64, paymentAddress) => {
  await signTransaction({
    payload: {
      network: {
        type: network,
      },
      message: "Sign Transaction",
      psbtBase64,
      broadcast: true,
      inputsToSign: [
        {
          address: paymentAddress,
          signingIndexes: [0],
          sigHash: btc.SignatureHash.SINGLE | btc.SignatureHash.ANYONECANPAY,
        },
      ],
    },
    onFinish: (response) => {
      console.log("response", response);
      return response.txid;
    },
    onCancel: (response) => {
      console.log("response", response);
    },
  });
};



export const signTransactionLeather = async (network, psbtBase64) => {
  try {
    // Convert the base64 PSBT to hex
    const psbtHex = Buffer.from(psbtBase64, 'base64').toString('hex');
    console.log("psbtHex", psbtHex);
    const signRequestParams = {
      hex: psbtHex,
      allowedSighash: [btc.SignatureHash.SINGLE | btc.SignatureHash.ANYONECANPAY],
      signAtIndex: 0, // Assuming you are signing the first input
      broadcast: true, // Set to false if you want to manually broadcast later
    };

    // Sign the PSBT
    const result = await window.btc.request('signPsbt', signRequestParams);

  } catch (error) {
    console.error("Error signing transaction with Leather wallet:", error);
    throw error;
  }
};



