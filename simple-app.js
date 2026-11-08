/*
 * sample-app.js — teste isolado de leitura de campos .config
 *
 * Este é um arquivo de teste independente, NÃO é a aplicação completa
 * e não deve substituir o simple-app.js do projeto.
 *
 * Abra sample-app-teste.html (se você criar uma página para carregá-lo)
 * ou execute no console do navegador com a função runSampleConfigTest().
 */

(function () {
  "use strict";

  function extractConfigKeys(content) {
    const keys = {};
    for (const line of String(content || "").split(/\r?\n/)) {
      const match = line.match(
        /^\s*(key_n_bt|key_device_id_unitvfree|key_sn_token_unitvfree|key_sn_flag_unitvfree)\s*=(.*)$/
      );
      if (match) keys[match[1]] = match[2].trim();
    }
    return keys;
  }

  function validateConfigKeys(keys) {
    const required = [
      keys.key_n_bt,
      keys.key_device_id_unitvfree,
      keys.key_sn_token_unitvfree
    ];

    const requiredValid = required.every(
      value => Boolean(value) &&
        /^[0-9a-f]+$/i.test(value) &&
        value.length % 2 === 0
    );

    const flag = keys.key_sn_flag_unitvfree;
    const optionalFlagValid =
      flag === undefined ||
      (/^[0-9a-f]+$/i.test(flag) && flag.length % 2 === 0);

    return {
      valid: requiredValid && optionalFlagValid,
      requiredValid,
      optionalFlagValid
    };
  }

  function runSampleConfigTest(content) {
    const sample = content || [
      "# Valores fictícios para teste de leitura; não são credenciais reais",
      "key_n_bt=0011223344556677",
      "key_device_id_unitvfree=89abcdef01234567",
      "key_sn_token_unitvfree=1122334455667788",
      "key_sn_flag_unitvfree=a1b2c3d4"
    ].join("\n");

    const keys = extractConfigKeys(sample);
    const validation = validateConfigKeys(keys);
    const result = {
      keysFound: Object.keys(keys),
      flagFound: Object.prototype.hasOwnProperty.call(
        keys, "key_sn_flag_unitvfree"
      ),
      validation,
      parsedKeys: keys
    };

    console.log("Resultado do teste de leitura .config:", result);
    return result;
  }

  // Expõe apenas funções de teste para facilitar a verificação no navegador.
  window.SampleConfigTest = {
    extractConfigKeys,
    validateConfigKeys,
    runSampleConfigTest
  };

  console.info(
    "sample-app.js carregado. Execute SampleConfigTest.runSampleConfigTest() para testar."
  );
})();
