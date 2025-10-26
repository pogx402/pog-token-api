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

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ERC-20 ABI (minimal)
const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const pogContract = new ethers.Contract(POG_CONTRACT_ADDRESS, ERC20_ABI, wallet);

// Store processed payments (prevent double-minting)
const processedPayments = new Set();

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'POG Token x402 API',
        description: 'Mint POG tokens using x402 Protocol - No frontend needed!',
        version: '2.3.0-free',
        endpoints: {
            '/': 'API information',
            '/mint': 'Mint 10,000 POG tokens (FREE for testing)',
            '/stats': 'Minting statistics'
        },
        x402: {
            version: 1,
            resource: '/mint',
            price: '1 USDC (not enforced yet)',
            reward: '10,000 POG tokens'
        },
        contract: {
            address: POG_CONTRACT_ADDRESS,
            network: 'Base Mainnet',
            chainId: 8453,
            symbol: 'POG',
            name: 'POG'
        },
        notice: 'Currently in FREE mode for testing - USDC payment not enforced',
        usage: {
            '1': 'Visit x402scan.com',
            '2': 'Search for this API or paste the URL',
            '3': 'Click to authorize (no actual payment required yet)',
            '4': 'Receive 10,000 POG tokens automatically'
        }
    });
});

// Mint endpoint (x402)
app.get('/mint', async (req, res) => {
    const paymentHeader = req.headers['x-payment'] || req.headers['x-payment-tx'];

    // If no payment proof, return 402 with x402 schema
    if (!paymentHeader) {
        return res.status(402).json({
            x402Version: 1,
            error: 'X-PAYMENT header is required',
            accepts: [{
                scheme: 'exact',
                network: 'base',
                maxAmountRequired: '1000000', // 1 USDC (6 decimals)
                resource: 'https://pog-token-api.vercel.app/mint',
                description: 'Mint 10,000 $POG tokens - Pay 1 USDC on Base, get POG tokens instantly!',
                mimeType: '',
                payTo: wallet.address,
                maxTimeoutSeconds: 60,
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
                    version: '2'
                }
            }]
        });
    }

    // Process payment
    try {
        // Decode x402 payment data
        let paymentData;
        let payer;
        let paymentId;

        try {
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
            paymentData = JSON.parse(decoded);
            console.log('[INFO] Received x402 payment authorization');
            
            // Extract payer address
            if (paymentData.payload && paymentData.payload.authorization) {
                payer = paymentData.payload.authorization.from;
                paymentId = paymentData.payload.signature;
            } else {
                throw new Error('Missing authorization data');
            }
        } catch (e) {
            console.error('[ERROR] Failed to parse payment data:', e.message);
            return res.status(400).json({
                success: false,
                error: 'Invalid payment format',
                message: 'Payment data must be base64-encoded JSON'
            });
        }

        // Check if already processed
        if (processedPayments.has(paymentId)) {
            return res.status(400).json({
                success: false,
                error: 'Payment already processed'
            });
        }

        console.log('[INFO] Minting POG tokens to', payer);
        console.log('[NOTICE] FREE MODE - No USDC payment verification');

        // Mint POG tokens to payer
        const mintAmount = ethers.parseEther('10000'); // 10,000 POG
        const mintTx = await pogContract.transfer(payer, mintAmount);
        const mintReceipt = await mintTx.wait();

        // Mark as processed
        processedPayments.add(paymentId);

        console.log('[SUCCESS] Mint complete:', mintTx.hash);

        res.json({
            success: true,
            transactionHash: mintTx.hash,
            recipient: payer,
            amount: '10000 POG',
            notice: 'FREE mode - No USDC payment required'
        });

    } catch (error) {
        console.error('[ERROR] Processing payment:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process payment',
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
            pricePerMint: '1 USDC (not enforced)',
            tokensPerMint: '10,000 POG',
            network: 'Base Mainnet',
            paymentAddress: wallet.address,
            mode: 'FREE (testing)'
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
    console.log(`📍 Payment Address: ${wallet.address}`);
    console.log(`🪙 POG Contract: ${POG_CONTRACT_ADDRESS}`);
    console.log(`💰 USDC Contract: ${USDC_CONTRACT_ADDRESS}`);
    console.log(`\n⚠️  FREE MODE - No USDC payment verification`);
    console.log(`✅ API is ready to mint POG tokens!`);
});

export default app;

