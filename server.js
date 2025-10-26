import express from 'express';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const POG_CONTRACT_ADDRESS = process.env.POG_CONTRACT_ADDRESS;
const USDC_CONTRACT_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base Mainnet USDC
const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS || new ethers.Wallet(PRIVATE_KEY).address;

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ERC-20 ABI (minimal)
const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const pogContract = new ethers.Contract(POG_CONTRACT_ADDRESS, ERC20_ABI, wallet);
const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, provider);

// Store processed payments (prevent double-minting)
const processedPayments = new Map(); // Changed to Map to store tx hash -> payer address

// Constants
const REQUIRED_USDC_AMOUNT = ethers.parseUnits('1', 6); // 1 USDC (6 decimals)
const POG_MINT_AMOUNT = ethers.parseEther('10000'); // 10,000 POG

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'POG Token x402 API',
        description: 'Mint POG tokens using x402 Protocol - Payment Required!',
        version: '2.4.0-payment-enforced',
        endpoints: {
            '/': 'API information',
            '/mint': 'Mint 10,000 POG tokens (requires 1 USDC payment)',
            '/stats': 'Minting statistics'
        },
        x402: {
            version: 1,
            resource: '/mint',
            price: '1 USDC',
            reward: '10,000 POG tokens'
        },
        contract: {
            address: POG_CONTRACT_ADDRESS,
            network: 'Base Mainnet',
            chainId: 8453,
            symbol: 'POG',
            name: 'POG'
        },
        notice: 'Payment verification ENABLED - USDC payment is required',
        usage: {
            '1': 'Visit x402scan.com',
            '2': 'Search for this API or paste the URL',
            '3': 'Send 1 USDC to payment address',
            '4': 'Get transaction hash from blockchain',
            '5': 'Call /mint with X-Payment-Tx header containing tx hash',
            '6': 'Receive 10,000 POG tokens automatically'
        }
    });
});

// Verify USDC payment on blockchain
async function verifyUSDCPayment(txHash, payer) {
    try {
        console.log(`[INFO] Verifying USDC payment: ${txHash}`);
        console.log(`[INFO] Payment Address: ${PAYMENT_ADDRESS}`);
        console.log(`[INFO] Payer: ${payer}`);
        
        // Get transaction receipt
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (!receipt) {
            console.error('[ERROR] Transaction not found on blockchain');
            console.error(`[ERROR] Checked hash: ${txHash}`);
            console.error('[ERROR] Possible reasons:');
            console.error('  1. Transaction hash is incorrect');
            console.error('  2. Transaction is still pending (not confirmed)');
            console.error('  3. Transaction was on a different network');
            return { verified: false, error: 'Transaction not found. Please verify the hash and ensure it is confirmed.' };
        }

        // Check if transaction was successful
        if (receipt.status !== 1) {
            console.error('[ERROR] Transaction failed');
            return { verified: false, error: 'Transaction failed' };
        }

        // Get the transaction
        const tx = await provider.getTransaction(txHash);
        
        if (!tx) {
            console.error('[ERROR] Transaction details not found');
            return { verified: false, error: 'Transaction details not found' };
        }

        // Parse transaction logs for USDC transfer
        let usdcTransferFound = false;
        let transferAmount = ethers.toBigInt(0);
        let transferTo = null;

        for (const log of receipt.logs) {
            try {
                // Check if this is a USDC transfer event
                if (log.address.toLowerCase() === USDC_CONTRACT_ADDRESS.toLowerCase()) {
                    // Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
                    const eventTopic = ethers.id('Transfer(address,address,uint256)');
                    
                    if (log.topics[0] === eventTopic) {
                        // Parse the transfer
                        const transferFromAddress = '0x' + log.topics[1].slice(26);
                        const transferToAddress = '0x' + log.topics[2].slice(26);
                        const amount = ethers.toBigInt(log.data);

                        console.log(`[INFO] USDC Transfer found: ${transferFromAddress} -> ${transferToAddress}, Amount: ${ethers.formatUnits(amount, 6)}`);

                        // Check if payment is to our payment address
                        if (transferToAddress.toLowerCase() === PAYMENT_ADDRESS.toLowerCase() && 
                            amount >= REQUIRED_USDC_AMOUNT) {
                            usdcTransferFound = true;
                            transferAmount = amount;
                            transferTo = transferFromAddress;
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('[DEBUG] Could not parse log:', e.message);
            }
        }

        if (!usdcTransferFound) {
            console.error('[ERROR] No valid USDC transfer found in transaction');
            return { verified: false, error: 'No USDC transfer to payment address found' };
        }

        // Verify the payer matches (if provided)
        if (payer && payer.toLowerCase() !== transferTo.toLowerCase()) {
            console.error('[ERROR] Payer address mismatch');
            return { verified: false, error: 'Payer address does not match transaction' };
        }

        console.log('[SUCCESS] USDC payment verified:', {
            txHash,
            from: transferTo,
            amount: ethers.formatUnits(transferAmount, 6),
            to: PAYMENT_ADDRESS
        });

        return { 
            verified: true, 
            payer: transferTo,
            amount: transferAmount
        };

    } catch (error) {
        console.error('[ERROR] Payment verification failed:', error.message);
        return { verified: false, error: error.message };
    }
}

// Mint endpoint (x402)
app.get('/mint', async (req, res) => {
    const paymentTxHeader = req.headers['x-payment-tx'];
    const paymentHeader = req.headers['x-payment'];
    const payerQuery = req.query.payer;

    // If no payment proof, return 402 with x402 schema
    if (!paymentTxHeader && !paymentHeader) {
        return res.status(402).json({
            x402Version: 1,
            error: 'X-Payment-Tx header is required',
            message: 'Please provide USDC transaction hash in X-Payment-Tx header',
            accepts: [{
                scheme: 'exact',
                network: 'base',
                maxAmountRequired: '1000000', // 1 USDC (6 decimals)
                resource: 'https://pog-token-api.vercel.app/mint',
                description: 'Mint 10,000 $POG tokens - Pay 1 USDC on Base, get POG tokens instantly!',
                mimeType: 'application/json',
                payTo: PAYMENT_ADDRESS,
                maxTimeoutSeconds: 300,
                asset: USDC_CONTRACT_ADDRESS,
                outputSchema: {
                    input: {
                        type: 'http',
                        method: 'GET',
                        discoverable: true
                    }
                },
                extra: {
                    name: 'POG Token',
                    version: '2',
                    requiredAmount: '1',
                    requiredDecimals: 6
                }
            }]
        });
    }

    // Use X-Payment-Tx header (transaction hash)
    let txHash = paymentTxHeader || paymentHeader;
    
    // Clean and validate transaction hash
    if (txHash) {
        // Remove '0x' prefix if present
        if (txHash.startsWith('0x')) {
            txHash = txHash.slice(2);
        }
        
        // If hash is too long (130 chars), it might be double-encoded or have extra data
        // Take only the first 64 characters (valid tx hash)
        if (txHash.length > 64) {
            console.log(`[WARN] Transaction hash too long (${txHash.length}), truncating to 64 chars`);
            txHash = txHash.slice(0, 64);
        }
        
        // Re-add 0x prefix
        txHash = '0x' + txHash;
        
        console.log(`[INFO] Cleaned transaction hash: ${txHash}`);
    }

    try {
        // Check if already processed
        if (processedPayments.has(txHash)) {
            console.log('[WARN] Payment already processed:', txHash);
            return res.status(400).json({
                success: false,
                error: 'Payment already processed',
                message: 'This transaction has already been used to mint tokens',
                transactionHash: txHash
            });
        }

        // Verify USDC payment on blockchain
        const verification = await verifyUSDCPayment(txHash, payerQuery);

        if (!verification.verified) {
            console.error('[ERROR] Payment verification failed:', verification.error);
            return res.status(402).json({
                success: false,
                error: 'Payment verification failed',
                message: verification.error,
                x402Version: 1,
                accepts: [{
                    scheme: 'exact',
                    network: 'base',
                    maxAmountRequired: '1000000',
                    resource: 'https://pog-token-api.vercel.app/mint',
                    description: 'Mint 10,000 $POG tokens - Pay 1 USDC on Base',
                    payTo: PAYMENT_ADDRESS,
                    asset: USDC_CONTRACT_ADDRESS
                }]
            });
        }

        const payer = verification.payer;

        console.log('[INFO] Minting POG tokens to', payer);

        // Mint POG tokens to payer
        const mintTx = await pogContract.transfer(payer, POG_MINT_AMOUNT);
        const mintReceipt = await mintTx.wait();

        if (!mintReceipt || mintReceipt.status !== 1) {
            throw new Error('Mint transaction failed');
        }

        // Mark as processed
        processedPayments.set(txHash, {
            payer,
            mintTxHash: mintTx.hash,
            timestamp: new Date().toISOString(),
            amount: '10000 POG'
        });

        console.log('[SUCCESS] Mint complete:', mintTx.hash);

        res.json({
            success: true,
            message: 'POG tokens minted successfully!',
            paymentTransaction: txHash,
            mintTransaction: mintTx.hash,
            recipient: payer,
            amount: '10,000 POG',
            network: 'Base Mainnet',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[ERROR] Processing mint request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process mint request',
            message: error.message
        });
    }
});

// Stats endpoint
app.get('/stats', async (req, res) => {
    try {
        const balance = await pogContract.balanceOf(wallet.address);
        const remaining = ethers.formatEther(balance);

        res.json({
            totalMints: processedPayments.size,
            remainingSupply: `${remaining} POG`,
            pricePerMint: '1 USDC',
            tokensPerMint: '10,000 POG',
            network: 'Base Mainnet',
            paymentAddress: PAYMENT_ADDRESS,
            mode: 'PAYMENT ENFORCED',
            usdcContract: USDC_CONTRACT_ADDRESS,
            pogContract: POG_CONTRACT_ADDRESS
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get stats',
            message: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 POG x402 API running on port ${PORT}`);
    console.log(`📍 Payment Address: ${PAYMENT_ADDRESS}`);
    console.log(`🪙 POG Contract: ${POG_CONTRACT_ADDRESS}`);
    console.log(`💰 USDC Contract: ${USDC_CONTRACT_ADDRESS}`);
    console.log(`\n✅ PAYMENT VERIFICATION ENABLED`);
    console.log(`✅ API is ready to mint POG tokens with payment verification!`);
});

export default app;

