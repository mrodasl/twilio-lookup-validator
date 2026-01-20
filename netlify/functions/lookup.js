const Twilio = require('twilio');

exports.handler = async function(event, context) {
    console.log('🔍 ========== LOOKUP FUNCTION CALLED ==========');
    console.log('HTTP Method:', event.httpMethod);
    console.log('Headers:', event.headers);
    console.log('Body:', event.body);
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Manejar preflight OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        console.log('🔄 Handling OPTIONS preflight');
        return { statusCode: 200, headers, body: '' };
    }

    // Solo permitir POST
    if (event.httpMethod !== 'POST') {
        console.log('❌ Method not allowed:', event.httpMethod);
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: 'Método no permitido. Use POST.' 
            })
        };
    }

    try {
        // Obtener credenciales de Twilio
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        console.log('🔐 Twilio Credentials Check:');
        console.log('- Account SID exists:', !!accountSid);
        console.log('- Auth Token exists:', !!authToken);
        console.log('- Account SID starts with AC?:', accountSid?.startsWith('AC'));
        console.log('- Auth Token length:', authToken?.length);

        if (!accountSid || !authToken) {
            console.error('❌ Twilio credentials missing');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Twilio credentials not configured in environment variables'
                })
            };
        }

        // Parsear datos
        let requestData;
        try {
            requestData = JSON.parse(event.body);
            console.log('📦 Parsed request data:', requestData);
        } catch (parseError) {
            console.error('❌ Error parsing JSON:', parseError);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid JSON format in request body'
                })
            };
        }

        const { number } = requestData;

        if (!number) {
            console.log('❌ No number provided');
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Número telefónico requerido'
                })
            };
        }

        console.log(`🔍 Processing lookup for: ${number}`);

        // Inicializar cliente Twilio
        const client = new Twilio(accountSid, authToken);
        
        // Limpiar número
        const cleanNumber = number.replace(/\s+/g, '');
        console.log(`🔧 Cleaned number: ${cleanNumber}`);

        // DEBUG: Probar diferentes enfoques
        console.log('🔄 Attempting Twilio Lookup...');
        
        try {
            // ENFOQUE 1: Método más simple (Lookup V1)
            console.log('📡 Trying Lookup V1 style...');
            const result = await client.lookups
                .phoneNumbers(cleanNumber)
                .fetch({ type: 'carrier' });
            
            console.log('✅ Lookup V1 Success!');
            console.log('Result:', {
                phoneNumber: result.phoneNumber,
                nationalFormat: result.nationalFormat,
                carrier: result.carrier,
                countryCode: result.countryCode
            });

            // Determinar estado
            let status = 'unknown';
            let message = 'Estado desconocido';
            
            if (result.carrier) {
                status = 'active';
                message = `✅ ACTIVO - ${result.carrier.name || 'Operador desconocido'}`;
            } else {
                status = 'inactive';
                message = '❌ INACTIVO - No se encontró información del operador';
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    status: status,
                    number: result.phoneNumber,
                    valid: true,
                    message: message,
                    carrier: result.carrier?.name || 'Desconocido',
                    country: result.countryCode || 'N/A',
                    carrierType: result.carrier?.type || 'unknown',
                    timestamp: new Date().toISOString(),
                    method: 'lookup_v1'
                })
            };

        } catch (v1Error) {
            console.log('⚠️ Lookup V1 failed:', v1Error.message);
            
            // ENFOQUE 2: Intentar con Lookup V2
            try {
                console.log('📡 Trying Lookup V2 with minimal fields...');
                const v2Result = await client.lookups.v2.phoneNumbers(cleanNumber)
                    .fetch({ fields: 'line_type_intelligence' });
                
                console.log('✅ Lookup V2 Success!');
                console.log('V2 Result:', {
                    phoneNumber: v2Result.phoneNumber,
                    valid: v2Result.valid,
                    lineType: v2Result.lineTypeIntelligence
                });

                let status = 'unknown';
                let message = 'Estado desconocido';
                
                if (v2Result.lineTypeIntelligence) {
                    const lineType = v2Result.lineTypeIntelligence.type;
                    if (lineType === 'mobile' || lineType === 'landline' || lineType === 'voip') {
                        status = 'active';
                        message = `✅ ACTIVO - Línea ${lineType}`;
                    } else if (lineType === 'invalid') {
                        status = 'inactive';
                        message = '❌ INACTIVO - Línea no válida';
                    }
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        status: status,
                        number: v2Result.phoneNumber,
                        valid: v2Result.valid,
                        message: message,
                        lineType: v2Result.lineTypeIntelligence?.type || 'unknown',
                        country: v2Result.countryCode || 'N/A',
                        timestamp: new Date().toISOString(),
                        method: 'lookup_v2_minimal'
                    })
                };

            } catch (v2Error) {
                console.error('❌ Both Lookup methods failed');
                console.error('V2 Error details:', {
                    code: v2Error.code,
                    status: v2Error.status,
                    message: v2Error.message,
                    moreInfo: v2Error.moreInfo
                });

                // ENFOQUE 3: Intentar con Verify API como fallback
                try {
                    console.log('🔄 Trying Verify API as fallback...');
                    const verifyResult = await client.verify.v2.services
                        .create({ friendlyName: 'Lookup Test' });
                    
                    console.log('Verify service created:', verifyResult.sid);
                    
                    // Intentar verificar el número
                    const verification = await client.verify.v2.services(verifyResult.sid)
                        .verifications
                        .create({ to: cleanNumber, channel: 'sms' });
                    
                    console.log('Verification started:', verification.status);
                    
                    // Limpiar servicio de verify
                    await client.verify.v2.services(verifyResult.sid).remove();
                    
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            success: true,
                            status: 'active',
                            number: cleanNumber,
                            valid: true,
                            message: '✅ ACTIVO - Número acepta verificación SMS',
                            method: 'verify_api_fallback',
                            verificationStatus: verification.status,
                            timestamp: new Date().toISOString()
                        })
                    };

                } catch (verifyError) {
                    console.error('❌ Verify API also failed:', verifyError.message);
                    
                    // Error final con todos los detalles
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({
                            success: false,
                            status: 'error',
                            error: 'Todas las APIs de Twilio fallaron',
                            details: {
                                v1Error: v1Error.message,
                                v2Error: v2Error.message,
                                verifyError: verifyError.message,
                                v1Code: v1Error.code,
                                v2Code: v2Error.code
                            },
                            timestamp: new Date().toISOString()
                        })
                    };
                }
            }
        }

    } catch (error) {
        console.error('❌ UNEXPECTED ERROR in handler:', error);
        console.error('Stack:', error.stack);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: false,
                status: 'error',
                error: 'Error interno del servidor',
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                timestamp: new Date().toISOString()
            })
        };
    }
};
