const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const filesToObfuscate = [
    {
        input: path.join(__dirname, '..', 'Script.js'),
        output: path.join(__dirname, '..', 'Script.js') // Sobrescribir el original
    },
    {
        input: path.join(__dirname, 'admin.js'),
        output: path.join(__dirname, 'admin.js') // Sobrescribir el original
    },
    {
        input: path.join(__dirname, '..', 'protection.js'),
        output: path.join(__dirname, '..', 'protection.js') // Sobrescribir el original
    }
];

const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: true,
    debugProtectionInterval: 4000,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

console.log('Iniciando ofuscación de archivos...');

filesToObfuscate.forEach(file => {
    if (fs.existsSync(file.input)) {
        console.log(`Ofuscando: ${file.input}`);
        const originalCode = fs.readFileSync(file.input, 'utf8');
        const obfuscatedCode = JavaScriptObfuscator.obfuscate(originalCode, obfuscationOptions).getObfuscatedCode();
        fs.writeFileSync(file.output, obfuscatedCode);
        console.log(`Ofuscación completada para: ${file.output}`);
    } else {
        console.warn(`ADVERTENCIA: El archivo de entrada no se encontró: ${file.input}`);
    }
});

console.log('Proceso de ofuscación finalizado.');
