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

// USDC ABI with Permit (EIP-2612)
const USDC_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const pogContract = new ethers.Contract(POG_CONTRACT_ADDRESS, ERC20_ABI, wallet);
const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, USDC_ABI, wallet);

// Store processed payments
const processedPayments = new Set();

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'POG Token x402 API',
        description: 'Mint POG tokens using x402 Protocol - No frontend needed!',
        version: '2.2.0',
        endpoints: {
            '/': 'API information',
            '/mint': 'Mint 10,000 POG tokens for 1 USDC (x402)',
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
        usage: {
            '1': 'Visit x402scan.com',
            '2': 'Search for this API or paste the URL',
            '3': 'Sign the payment authorization',
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
                        discoverable: true,
                        properties: {}
                    },
                    output: {
                        type: 'object',
                        properties: {
                            success: {
                                type: 'boolean'
                            },
                            transactionHash: {
                                type: 'string'
                            },
                            recipient: {
                                type: 'string'
                            },
                            amount: {
                                type: 'string'
                            }
                        }
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
        try {
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
            paymentData = JSON.parse(decoded);
            console.log('[INFO] Received x402 payment authorization');
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payment format',
                message: 'Payment data must be base64-encoded JSON'
            });
        }

        // Extract authorization data
        if (!paymentData.payload || !paymentData.payload.authorization) {
            return res.status(400).json({
                success: false,
                error: 'Missing authorization data'
            });
        }

        const auth = paymentData.payload.authorization;
        const signature = paymentData.payload.signature;
        const payer = auth.from;
        const paymentId = signature;

        // Check if already processed
        if (processedPayments.has(paymentId)) {
            return res.status(400).json({
                success: false,
                error: 'Payment already processed'
            });
        }

        // Verify payment amount
        const paymentAmount = parseInt(auth.value);
        if (paymentAmount < 1000000) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient payment amount',
                message: 'Must pay at least 1 USDC'
            });
        }

        // Verify recipient
        if (auth.to.toLowerCase() !== wallet.address.toLowerCase()) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payment recipient',
                message: `Payment must be sent to ${wallet.address}`
            });
        }

        // Split signature into v, r, s
        const sig = ethers.Signature.from(signature);

        console.log('[INFO] Attempting permit + transferFrom...');

        // Try Permit (EIP-2612) approach
        try {
            // Execute permit to approve our wallet
            const permitTx = await usdcContract.permit(
                auth.from,           // owner
                wallet.address,      // spender (us)
                auth.value,          // value
                auth.validBefore,    // deadline
                sig.v,
                sig.r,
                sig.s
            );
            
            console.log('[INFO] Permit transaction sent:', permitTx.hash);
            const permitReceipt = await permitTx.wait();
            
            if (!permitReceipt || permitReceipt.status !== 1) {
                throw new Error('Permit transaction failed');
            }
            
            console.log('[INFO] Permit successful, executing transferFrom...');
            
            // Now transfer USDC from user to us
            const transferTx = await usdcContract.transferFrom(
                auth.from,
                wallet.address,
                auth.value
            );
            
            console.log('[INFO] TransferFrom transaction sent:', transferTx.hash);
            const transferReceipt = await transferTx.wait();
            
            if (!transferReceipt || transferReceipt.status !== 1) {
                throw new Error('USDC transfer failed');
            }
            
            console.log('[INFO] USDC transfer successful');
            
        } catch (permitError) {
            console.error('[ERROR] Permit/TransferFrom failed:', permitError.message);
            return res.status(400).json({
                success: false,
                error: 'Payment authorization failed',
                message: permitError.message
            });
        }

        // Mint POG tokens to payer
        console.log('[INFO] Minting POG tokens to', payer);
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
            amount: '10000 POG'
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
            pricePerMint: '1 USDC',
            tokensPerMint: '10,000 POG',
            network: 'Base Mainnet',
            paymentAddress: wallet.address
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
    console.log(`\n✅ API is ready to accept payments!`);
});

export default app;

