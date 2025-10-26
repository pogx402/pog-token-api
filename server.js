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
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const pogContract = new ethers.Contract(POG_CONTRACT_ADDRESS, ERC20_ABI, wallet);
const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, provider);

// Store processed payments
const processedPayments = new Set();

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'POG Token x402 API',
        description: 'Mint POG tokens using x402 Protocol - No frontend needed!',
        version: '2.0.0',
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
            '3': 'Pay 1 USDC',
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
        // Check if it's a base64-encoded x402 payment
        let paymentData;
        try {
            const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
            paymentData = JSON.parse(decoded);
        } catch (e) {
            // If not base64, treat as transaction hash
            paymentData = null;
        }

        let payer;
        let paymentId;

        if (paymentData && paymentData.payload && paymentData.payload.authorization) {
            // x402 Protocol payment with EIP-712 signature
            const auth = paymentData.payload.authorization;
            payer = auth.from;
            paymentId = paymentData.payload.signature;

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

            // For now, we trust the signature verification done by x402scan
            // In production, you should verify the EIP-712 signature here

        } else {
            // Legacy: Direct transaction hash
            paymentId = paymentHeader;

            // Check if already processed
            if (processedPayments.has(paymentId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment already processed'
                });
            }

            // Get transaction
            const tx = await provider.getTransaction(paymentHeader);
            if (!tx) {
                return res.status(400).json({
                    success: false,
                    error: 'Transaction not found',
                    message: 'Please wait for the transaction to be confirmed'
                });
            }

            // Wait for confirmation
            const receipt = await tx.wait();
            if (!receipt || receipt.status !== 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Transaction failed'
                });
            }

            // Verify USDC transfer
            let isValidPayment = false;
            for (const log of receipt.logs) {
                try {
                    const parsedLog = usdcContract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });

                    if (parsedLog && parsedLog.name === 'Transfer') {
                        const [from, to, amount] = parsedLog.args;
                        
                        if (to.toLowerCase() === wallet.address.toLowerCase() && 
                            amount >= 1000000n) {
                            isValidPayment = true;
                            payer = from;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!isValidPayment) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid payment'
                });
            }
        }

        // Mint POG tokens to payer
        const mintAmount = ethers.parseEther('10000'); // 10,000 POG
        const mintTx = await pogContract.transfer(payer, mintAmount);
        const mintReceipt = await mintTx.wait();

        // Mark as processed
        processedPayments.add(paymentId);

        res.json({
            success: true,
            transactionHash: mintTx.hash,
            recipient: payer,
            amount: '10000 POG'
        });

    } catch (error) {
        console.error('Error processing payment:', error);
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

