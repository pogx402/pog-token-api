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
const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, provider);

// Store processed transactions
const processedTxs = new Set();

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
    const paymentTxHash = req.headers['x-payment-tx'];

    // If no payment proof, return 402 with x402 schema
    if (!paymentTxHash) {
        // Create the WWW-Authenticate header content
        const FACILITATOR_URL = 'https://x402.org/facilitator'; // Coinbase CDP Facilitator
        const x402AuthHeader = `x402 scheme="exact", network="base", payTo="${wallet.address}", maxAmountRequired="1000000", asset="${USDC_CONTRACT_ADDRESS}", resource="https://pog-token-api.vercel.app/mint", description="Mint 10,000 $POG tokens - Pay 1 USDC on Base, get POG tokens instantly!", facilitator="${FACILITATOR_URL}"`;

        // Set the WWW-Authenticate header and return 402
        res.set('WWW-Authenticate', x402AuthHeader);
        return res.status(402).json({
            x402Version: 1,
            accepts: [{
                scheme: 'exact',
                network: 'base',
                maxAmountRequired: '1000000', // 1 USDC (6 decimals)
                resource: 'https://pog-token-api.vercel.app/mint',
                description: 'Mint 10,000 $POG tokens - Pay 1 USDC on Base, get POG tokens instantly!',
                mimeType: 'application/json',
                payTo: wallet.address,
                maxTimeoutSeconds: 300,
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
                                type: 'boolean',
                                description: 'Whether the minting was successful'
                            },
                            message: { 
                                type: 'string',
                                description: 'Success or error message'
                            },
                            txHash: { 
                                type: 'string',
                                description: 'Transaction hash of the POG token transfer'
                            },
                            amount: { 
                                type: 'string',
                                description: 'Amount of POG tokens minted'
                            },
                            recipient: { 
                                type: 'string',
                                description: 'Address that received the POG tokens'
                            }
                        }
                    }
                }
            }],
            error: 'Payment required to mint POG tokens'
        });
    }

    // Verify payment
    try {
        // Check if already processed
        if (processedTxs.has(paymentTxHash)) {
            return res.status(400).json({
                success: false,
                error: 'Payment already processed',
                message: 'This transaction has already been used to mint tokens'
            });
        }

        // Get transaction
        const tx = await provider.getTransaction(paymentTxHash);
        if (!tx) {
            return res.status(400).json({
                success: false,
                error: 'Transaction not found',
                message: 'Please wait for the transaction to be confirmed on the blockchain'
            });
        }

        // Wait for confirmation
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) {
            return res.status(400).json({
                success: false,
                error: 'Transaction failed',
                message: 'The payment transaction failed or was not confirmed'
            });
        }

        // Verify it's a USDC transfer to our address
        let isValidPayment = false;
        let payer = null;

        for (const log of receipt.logs) {
            try {
                const parsedLog = usdcContract.interface.parseLog({
                    topics: log.topics,
                    data: log.data
                });

                if (parsedLog && parsedLog.name === 'Transfer') {
                    const [from, to, amount] = parsedLog.args;
                    
                    // Check if it's to our wallet and amount >= 1 USDC
                    if (to.toLowerCase() === wallet.address.toLowerCase() && 
                        amount >= 1000000n) { // 1 USDC = 1,000,000 (6 decimals)
                        isValidPayment = true;
                        payer = from;
                        break;
                    }
                }
            } catch (e) {
                // Skip logs that aren't USDC transfers
                continue;
            }
        }

        if (!isValidPayment) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payment',
                message: `Must send at least 1 USDC to ${wallet.address} on Base Mainnet`
            });
        }

        // Mint POG tokens to payer
        const mintAmount = ethers.parseEther('10000'); // 10,000 POG
        const mintTx = await pogContract.transfer(payer, mintAmount);
        await mintTx.wait();

        // Mark as processed
        processedTxs.add(paymentTxHash);

        return res.status(200).json({
            success: true,
            message: 'Successfully minted 10,000 POG tokens!',
            txHash: mintTx.hash,
            amount: '10000 POG',
            recipient: payer,
            viewOnBaseScan: `https://basescan.org/tx/${mintTx.hash}`
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
            totalMints: processedTxs.size,
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

