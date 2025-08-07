#!/usr/bin/env python3
"""
Frontend Dashboard served as FastAPI HTML response
"""

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

dashboard_html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VeriChainX - AI Counterfeit Detection Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
        }
        
        .header h1 {
            font-size: 3rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .header .tagline {
            font-size: 1.2rem;
            opacity: 0.9;
        }
        
        .hackathon-badges {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin: 30px 0;
        }
        
        .badge {
            background: rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
            padding: 10px 20px;
            border-radius: 25px;
            color: white;
            font-weight: bold;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .card {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 12px 40px rgba(0,0,0,0.15);
        }
        
        .card h3 {
            margin-bottom: 15px;
            color: #333;
            font-size: 1.3rem;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }
        
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }
        
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        
        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.3s ease;
            width: 100%;
        }
        
        .btn:hover {
            transform: translateY(-2px);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .result {
            margin-top: 20px;
            padding: 15px;
            border-radius: 8px;
            font-size: 14px;
        }
        
        .result.success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        
        .result.warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
        }
        
        .result.error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .stat-item {
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
        }
        
        .stat-label {
            font-size: 0.9rem;
            color: #666;
        }
        
        .features-list {
            list-style: none;
        }
        
        .features-list li {
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .features-list li:last-child {
            border-bottom: none;
        }
        
        .features-list li:before {
            content: "✓";
            color: #28a745;
            font-weight: bold;
            margin-right: 10px;
        }
        
        .loading {
            text-align: center;
            color: #666;
        }
        
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 10px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .footer {
            text-align: center;
            color: rgba(255,255,255,0.8);
            margin-top: 40px;
            padding: 20px;
        }
        
        .demo-products {
            display: grid;
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .demo-product {
            padding: 10px;
            background: #f8f9fa;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.3s ease;
            font-size: 0.9rem;
        }
        
        .demo-product:hover {
            background: #e9ecef;
        }

        .api-links {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .api-link {
            padding: 8px 16px;
            background: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-size: 14px;
            transition: background 0.3s ease;
        }
        
        .api-link:hover {
            background: #0056b3;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>VeriChainX</h1>
            <p class="tagline">AI-Powered Counterfeit Detection System</p>
            <div class="hackathon-badges">
                <div class="badge">🏆 TiDB 2025 Hackathon</div>
                <div class="badge">🚀 Hedera Hackathon</div>
            </div>
        </div>

        <div class="dashboard">
            <div class="card">
                <h3>🔍 Product Analysis</h3>
                
                <div class="api-links">
                    <a href="/docs" class="api-link" target="_blank">📚 API Docs</a>
                    <a href="/health" class="api-link" target="_blank">❤️ Health Check</a>
                    <a href="/redoc" class="api-link" target="_blank">📖 ReDoc</a>
                </div>

                <form id="analysisForm">
                    <div class="form-group">
                        <label>Product Name:</label>
                        <input type="text" id="productName" placeholder="e.g., iPhone 15 Pro" required>
                    </div>
                    <div class="form-group">
                        <label>Description:</label>
                        <textarea id="description" rows="3" placeholder="Product description and details" required></textarea>
                    </div>
                    <div class="form-group">
                        <label>Price ($):</label>
                        <input type="number" id="price" step="0.01" placeholder="999.99" required>
                    </div>
                    <div class="form-group">
                        <label>Category:</label>
                        <select id="category">
                            <option value="Electronics">Electronics</option>
                            <option value="Fashion">Fashion</option>
                            <option value="Luxury">Luxury Goods</option>
                            <option value="Automotive">Automotive</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Seller Name:</label>
                        <input type="text" id="sellerName" placeholder="Seller/Store name">
                    </div>
                    <button type="submit" class="btn" id="analyzeBtn">
                        🤖 Analyze with AI
                    </button>
                </form>

                <div class="demo-products">
                    <div class="demo-product" onclick="fillDemo('suspicious')">
                        📱 Try Demo: Suspicious iPhone ($199 - Too Low!)
                    </div>
                    <div class="demo-product" onclick="fillDemo('luxury')">
                        👜 Try Demo: Fake Luxury Handbag
                    </div>
                    <div class="demo-product" onclick="fillDemo('legitimate')">
                        💍 Try Demo: Legitimate Jewelry
                    </div>
                </div>

                <div id="analysisResult"></div>
            </div>

            <div class="card">
                <h3>📊 System Status</h3>
                <div id="systemStatus">
                    <div class="loading">
                        <div class="spinner"></div>
                        Loading system status...
                    </div>
                </div>
            </div>

            <div class="card">
                <h3>📈 Analytics Dashboard</h3>
                <div id="analytics">
                    <div class="loading">
                        <div class="spinner"></div>
                        Loading analytics...
                    </div>
                </div>
            </div>

            <div class="card">
                <h3>🚀 Key Features</h3>
                <ul class="features-list">
                    <li>Real-time AI-powered counterfeit detection</li>
                    <li>TiDB Cloud HTAP database with vector search</li>
                    <li>Multi-provider AI fallback system (OpenAI, Gemini, Groq, HF)</li>
                    <li>Hedera Hashgraph blockchain audit trails</li>
                    <li>Comprehensive analytics and reporting</li>
                    <li>Scalable multi-agent architecture</li>
                    <li>Enterprise-grade security</li>
                    <li>RESTful API for integration</li>
                </ul>
            </div>

            <div class="card">
                <h3>🗄️ TiDB Cloud Integration</h3>
                <div id="tidbStats">
                    <div class="loading">
                        <div class="spinner"></div>
                        Loading TiDB stats...
                    </div>
                </div>
            </div>

            <div class="card">
                <h3>🎯 Demo Instructions</h3>
                <ol style="padding-left: 20px;">
                    <li><strong>Try the Demo Products:</strong> Click any demo product button to auto-fill the form</li>
                    <li><strong>Analyze Products:</strong> Fill the form manually or use demos, then click "Analyze with AI"</li>
                    <li><strong>View Results:</strong> See AI analysis, authenticity scores, and recommendations</li>
                    <li><strong>Check API Docs:</strong> Visit /docs for complete API documentation</li>
                    <li><strong>Monitor System:</strong> Real-time status updates show TiDB and AI system health</li>
                </ol>
                <p style="margin-top: 15px; padding: 10px; background: #e8f4fd; border-radius: 6px; font-size: 14px;">
                    <strong>🏆 Hackathon Ready:</strong> This demo showcases TiDB Cloud's HTAP capabilities 
                    and Hedera's blockchain integration for enterprise counterfeit detection.
                </p>
            </div>
        </div>

        <div class="footer">
            <p><strong>Powered by:</strong> TiDB Cloud HTAP + Hedera Hashgraph + Multi-Provider AI</p>
            <p><strong>Built for:</strong> TiDB 2025 & Hedera Hackathons</p>
            <p><strong>Repository:</strong> <a href="https://github.com/ZubeidHendricks/verichainX-hedera" style="color: rgba(255,255,255,0.9);">GitHub</a></p>
        </div>
    </div>

    <script>
        const API_BASE_URL = window.location.origin;

        // Demo data sets
        const demoProducts = {
            suspicious: {
                productName: 'iPhone 15 Pro 256GB',
                description: 'Brand new iPhone 15 Pro, unlocked, comes with original box and accessories. Limited time offer!',
                price: 199.99,
                category: 'Electronics',
                sellerName: 'QuickDeals Electronics'
            },
            luxury: {
                productName: 'Louis Vuitton Neverfull MM',
                description: 'Authentic LV handbag, perfect condition, includes dustbag and authenticity card',
                price: 299.99,
                category: 'Luxury',
                sellerName: 'LuxuryOutlet Store'
            },
            legitimate: {
                productName: 'Diamond Engagement Ring 1.5ct',
                description: 'GIA certified diamond engagement ring, 14K white gold setting, includes GIA certificate and appraisal',
                price: 4999.99,
                category: 'Luxury',
                sellerName: 'DiamondsDirect Jewelry'
            }
        };

        function fillDemo(type) {
            const demo = demoProducts[type];
            document.getElementById('productName').value = demo.productName;
            document.getElementById('description').value = demo.description;
            document.getElementById('price').value = demo.price;
            document.getElementById('category').value = demo.category;
            document.getElementById('sellerName').value = demo.sellerName;
        }

        // Load initial data
        async function loadSystemStatus() {
            try {
                const response = await fetch(`${API_BASE_URL}/health`);
                const data = await response.json();
                
                const statusHtml = `
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value">✅</div>
                            <div class="stat-label">System Status</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${data.services.tidb_cloud === 'connected' ? '🟢' : '🔴'}</div>
                            <div class="stat-label">TiDB Cloud</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${data.services.openai !== 'demo mode' ? '🤖' : '🎯'}</div>
                            <div class="stat-label">AI Engine</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">⚡</div>
                            <div class="stat-label">Vector Search</div>
                        </div>
                    </div>
                    <p><strong>Database:</strong> ${data.database.provider}</p>
                    <p><strong>Features:</strong> ${data.database.features.join(', ')}</p>
                    <p><strong>Last Updated:</strong> ${new Date().toLocaleTimeString()}</p>
                `;
                
                document.getElementById('systemStatus').innerHTML = statusHtml;
            } catch (error) {
                document.getElementById('systemStatus').innerHTML = `
                    <div class="result error">
                        <strong>⚠️ Status Check Failed</strong><br>
                        ${error.message}
                    </div>
                `;
            }
        }

        async function loadAnalytics() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/v1/analytics/dashboard`);
                const data = await response.json();
                
                const analyticsHtml = `
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value">${data.total_products_analyzed}</div>
                            <div class="stat-label">Products Analyzed</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${data.counterfeit_detected}</div>
                            <div class="stat-label">Counterfeits Found</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${(data.detection_accuracy * 100).toFixed(1)}%</div>
                            <div class="stat-label">Detection Accuracy</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${data.avg_processing_time_ms}ms</div>
                            <div class="stat-label">Avg Response Time</div>
                        </div>
                    </div>
                    <p><strong>Recent Activity (24h):</strong> ${data.recent_analyses_24h} analyses</p>
                `;
                
                document.getElementById('analytics').innerHTML = analyticsHtml;
            } catch (error) {
                document.getElementById('analytics').innerHTML = `
                    <div class="result error">
                        <strong>⚠️ Analytics Loading Failed</strong><br>
                        ${error.message}
                    </div>
                `;
            }
        }

        async function loadTidbStats() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/v1/tidb/stats`);
                const data = await response.json();
                
                const tidbHtml = `
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value">${data.total_tables}</div>
                            <div class="stat-label">Database Tables</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${data.products_table_rows}</div>
                            <div class="stat-label">Products Stored</div>
                        </div>
                    </div>
                    <p><strong>TiDB Version:</strong> ${data.tidb_version.split(' ')[0]}</p>
                    <p><strong>HTAP Features:</strong> ${Object.keys(data.features).join(', ')}</p>
                    <p><strong>Database:</strong> ${data.database}</p>
                `;
                
                document.getElementById('tidbStats').innerHTML = tidbHtml;
            } catch (error) {
                document.getElementById('tidbStats').innerHTML = `
                    <div class="result error">
                        <strong>⚠️ TiDB Stats Loading Failed</strong><br>
                        ${error.message}
                    </div>
                `;
            }
        }

        // Product analysis form
        document.getElementById('analysisForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const analyzeBtn = document.getElementById('analyzeBtn');
            const resultDiv = document.getElementById('analysisResult');
            
            // Show loading state
            analyzeBtn.disabled = true;
            analyzeBtn.innerHTML = '🔄 Analyzing with AI...';
            resultDiv.innerHTML = '<div class="loading"><div class="spinner"></div>AI analysis in progress...<br><small>Using multi-provider AI system</small></div>';
            
            try {
                const formData = {
                    product_name: document.getElementById('productName').value,
                    description: document.getElementById('description').value,
                    price: parseFloat(document.getElementById('price').value),
                    category: document.getElementById('category').value,
                    seller_info: {
                        name: document.getElementById('sellerName').value || 'Unknown',
                        verified: false
                    }
                };
                
                const response = await fetch(`${API_BASE_URL}/api/v1/products/analyze`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(formData)
                });
                
                if (!response.ok) {
                    throw new Error(`API Error ${response.status}: ${response.statusText}`);
                }
                
                const result = await response.json();
                
                const resultClass = result.is_counterfeit ? 'warning' : 'success';
                const resultIcon = result.is_counterfeit ? '⚠️' : '✅';
                const status = result.is_counterfeit ? 'COUNTERFEIT DETECTED' : 'APPEARS AUTHENTIC';
                
                resultDiv.innerHTML = `
                    <div class="result ${resultClass}">
                        <h4 style="margin-bottom: 10px;">${resultIcon} ${status}</h4>
                        <div class="stats-grid" style="margin-bottom: 15px;">
                            <div class="stat-item">
                                <div class="stat-value">${(result.authenticity_score * 100).toFixed(1)}%</div>
                                <div class="stat-label">Authenticity Score</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">${(result.confidence * 100).toFixed(1)}%</div>
                                <div class="stat-label">AI Confidence</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">${result.processing_time_ms}</div>
                                <div class="stat-label">Processing Time (ms)</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">#${result.product_id}</div>
                                <div class="stat-label">Product ID</div>
                            </div>
                        </div>
                        
                        <h5>🤖 AI Analysis:</h5>
                        <p style="margin-bottom: 15px; padding: 10px; background: rgba(0,0,0,0.05); border-radius: 6px; font-style: italic;">${result.ai_analysis}</p>
                        
                        <h5>🔍 Evidence Found:</h5>
                        <ul style="margin-bottom: 15px;">
                            ${result.evidence.map(evidence => `<li>${evidence}</li>`).join('')}
                        </ul>
                        
                        <h5>💡 Recommendations:</h5>
                        <ul>
                            ${result.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                        </ul>

                        <p style="margin-top: 15px; font-size: 12px; color: #666;">
                            <strong>Stored in TiDB Cloud</strong> | Product saved with ID ${result.product_id} for analytics and audit trails
                        </p>
                    </div>
                `;
                
            } catch (error) {
                resultDiv.innerHTML = `
                    <div class="result error">
                        <h4>❌ Analysis Failed</h4>
                        <p><strong>Error:</strong> ${error.message}</p>
                        <p>Please check your input and try again. The AI system may be temporarily unavailable.</p>
                        <p><small>Our multi-provider AI system includes OpenAI, Gemini, Groq, and Hugging Face for high availability.</small></p>
                    </div>
                `;
            } finally {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = '🤖 Analyze with AI';
            }
        });

        // Load initial data when page loads
        window.addEventListener('load', () => {
            loadSystemStatus();
            loadAnalytics();
            loadTidbStats();
            
            // Auto-refresh system status every 30 seconds
            setInterval(loadSystemStatus, 30000);
        });
    </script>
</body>
</html>"""

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    """Serve the main dashboard"""
    return HTMLResponse(content=dashboard_html)