const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { ethers } = require('ethers');

// --- Configuration ---
// The private key of the wallet that will send the POG tokens (must have gas/POG tokens)
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || '0x...'; // Please set this in .env
const POG_CONTRACT_ADDRESS = process.env.POG_CONTRACT_ADDRESS || '0x...'; // Please set this in .env
const USDC_CONTRACT_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base Mainnet
const PAYMENT_ADDRESS = '0x7AE34aD98ABB28797e044f7Fad37364031F19152'; // The address that receives the USDC payment
const AMOUNT_REQUIRED = ethers.parseUnits("1", 6); // 1 USDC (6 decimals)
const MINT_AMOUNT = ethers.parseUnits("10000", 18); // 10,000 POG

// Provider for Base Mainnet
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const minterWallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);

// POG Token Contract ABI (Simplified)
const POG_ABI = [
    "function transfer(address to, uint256 amount) public returns (bool)",
    "function decimals() view returns (uint8)"
];
const pogContract = new ethers.Contract(POG_CONTRACT_ADDRESS, POG_ABI, minterWallet);

// USDC Contract ABI (Simplified for transfer verification)
const USDC_ABI = [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
];
const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, provider);

// --- Payment Verification Logic (Transaction Hash Check) ---

/**
 * Verifies if a transaction hash proves payment of 1 USDC to the PAYMENT_ADDRESS.
 * @param {string} txHash - The transaction hash to check.
 * @param {string} recipientAddress - The address that should receive the POG tokens.
 * @returns {Promise<{verified: boolean, error?: string, payerAddress?: string}>}
 */
async function verifyUSDCPayment(txHash, recipientAddress) {
    if (!txHash.startsWith('0x') || txHash.length !== 66) {
        return { verified: false, error: "Invalid transaction hash format." };
    }

    try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            return { verified: false, error: "Transaction not found or not yet confirmed." };
        }
        if (receipt.status !== 1) {
            return { verified: false, error: "Transaction failed on-chain." };
        }

        // 1. Check for the correct 'to' address (The PAYMENT_ADDRESS)
        const transaction = await provider.getTransaction(txHash);
        if (transaction.to.toLowerCase() !== USDC_CONTRACT_ADDRESS.toLowerCase()) {
             return { verified: false, error: "Transaction was not a call to the USDC contract." };
        }

        // 2. Check the logs for the Transfer event
        let paymentFound = false;
        let payerAddress = null;

        const transferTopic = ethers.id("Transfer(address,address,uint256)");
        
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() === USDC_CONTRACT_ADDRESS.toLowerCase() && log.topics[0] === transferTopic) {
                // Decode the log data
                const logInterface = new ethers.Interface(USDC_ABI);
                const decodedLog = logInterface.parseLog(log);

                if (decodedLog && decodedLog.name === 'Transfer') {
                    const from = decodedLog.args[0];
                    const to = decodedLog.args[1];
                    const value = decodedLog.args[2];

                    // Check if the transfer matches the required payment
                    if (to.toLowerCase() === PAYMENT_ADDRESS.toLowerCase() && value.toString() === AMOUNT_REQUIRED.toString()) {
                        paymentFound = true;
                        payerAddress = from;
                        break; // Found the payment
                    }
                }
            }
        }

        if (!paymentFound) {
            return { verified: false, error: `Payment of 1 USDC to ${PAYMENT_ADDRESS} not found in transaction logs.` };
        }
        
        // Final check: The payer must be the recipient or we need a way to link them (not implemented here)
        // For simplicity, we assume the payer is the one who initiated the transaction or we trust the frontend to provide the correct recipient.
        
        return { verified: true, payerAddress: payerAddress || transaction.from };

    } catch (error) {
        console.error("Verification error:", error);
        return { verified: false, error: `On-chain verification failed: ${error.message}` };
    }
}

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Simple in-memory storage for processed transactions to prevent double-minting
const processedTxs = new Set();

app.get('/mint', async (req, res) => {
    const txHash = req.headers['x-payment-tx'];
    const recipientAddress = req.headers['x-account']; // Assuming frontend sends the wallet address

    // 1. Check for Payment Header (x402 Protocol)
    if (!txHash) {
        return res.status(402).json({
            x402Version: 1,
            error: "Payment Required",
            message: "Please provide a transaction hash in the X-Payment-Tx header after paying 1 USDC.",
            accepts: [{
                scheme: "exact",
                network: "base",
                maxAmountRequired: AMOUNT_REQUIRED.toString(),
                resource: "https://pog-token-api.vercel.app/mint",
                description: "Mint 10,000 $POG tokens - Pay 1 USDC on Base",
                payTo: PAYMENT_ADDRESS,
                asset: USDC_CONTRACT_ADDRESS
            }]
        });
    }

    // 2. Check if already processed
    if (processedTxs.has(txHash)) {
        return res.status(400).json({ success: false, error: "Transaction already processed", message: "This transaction hash has already been used to mint tokens." });
    }

    // 3. Verify Payment
    const verificationResult = await verifyUSDCPayment(txHash, recipientAddress);

    if (!verificationResult.verified) {
        return res.status(402).json({
            success: false,
            error: "Payment verification failed",
            message: verificationResult.error,
            x402Version: 1,
            accepts: [{
                scheme: "exact",
                network: "base",
                maxAmountRequired: AMOUNT_REQUIRED.toString(),
                resource: "https://pog-token-api.vercel.app/mint",
                description: "Mint 10,000 $POG tokens - Pay 1 USDC on Base",
                payTo: PAYMENT_ADDRESS,
                asset: USDC_CONTRACT_ADDRESS
            }]
        });
    }

    // 4. Mint Tokens
    try {
        const mintRecipient = recipientAddress || verificationResult.payerAddress; // Use X-Account if provided, otherwise use the payer
        
        if (!mintRecipient) {
             return res.status(500).json({ success: false, error: "Internal Error", message: "Could not determine recipient address for minting." });
        }

        const tx = await pogContract.transfer(mintRecipient, MINT_AMOUNT);
        await tx.wait(); // Wait for the mint transaction to be confirmed

        // Record as processed
        processedTxs.add(txHash);

        res.json({
            success: true,
            message: "POG tokens minted successfully!",
            mintTransaction: tx.hash,
            recipient: mintRecipient,
            amount: ethers.formatUnits(MINT_AMOUNT, await pogContract.decimals()),
            network: "Base Mainnet",
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Minting error:", error);
        res.status(500).json({ success: false, error: "Minting Failed", message: error.message });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'pog-token-api', version: '1.0.0' });
});

// Start Server (Vercel handles the port, but for local testing)
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
