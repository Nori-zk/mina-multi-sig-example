import { frostHexToBase58, resolveHexGroupKey } from './utils.js';

// Real test data from a FROST DKG session
const groups = [
    {
        name: 'admin group (first DKG)',
        hex: 'a73cf73cf622322a7ec885fec639f0918de8e0699e9b328f459a587f22ecc22680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    },
    {
        name: 'token group',
        hex: '8456d7cc0896c7476e23b63a364f5548f61b2a4c801faebd8ffeef5d1d977f1a80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        base58: 'B62qntaKodiAjVbLPT5H8SptyGZLSn3gtaoHkbRJTQtPmdkjh5wcB2S',
    },
    {
        name: 'admin group (second DKG)',
        hex: 'b0ba3f4eb778d361ca6438e0779e8640c1169a1c79fd3795bab43b2bdffae40980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        base58: 'B62qpNrriZPQFXpP8STSQB5ZWGZYtmtocFA2o4eNyfywGXgCPEKapya',
    },
];

describe('frostHexToBase58', () => {
    for (const group of groups) {
        if (!group.base58) continue;
        it(`converts ${group.name} hex to correct base58 address`, () => {
            expect(frostHexToBase58(group.hex)).toBe(group.base58);
        });
    }

    it('produces a valid B62 address for each group', () => {
        for (const { hex } of groups) {
            expect(frostHexToBase58(hex)).toMatch(/^B62q/);
        }
    });

    it('throws on empty hex', () => {
        expect(() => frostHexToBase58('')).toThrow();
    });

    it('throws on malformed hex', () => {
        expect(() => frostHexToBase58('zzzz')).toThrow();
    });
});

describe('resolveHexGroupKey', () => {
    const frostConfig = groups.map(g => `[group.${g.hex}]\ndescription = "${g.name}"`).join('\n\n');

    it('resolves token base58 to correct hex key', () => {
        expect(resolveHexGroupKey(frostConfig, groups[1].base58!)).toBe(groups[1].hex);
    });

    it('resolves admin base58 to correct hex key', () => {
        expect(resolveHexGroupKey(frostConfig, groups[2].base58!)).toBe(groups[2].hex);
    });

    it('throws for unknown base58 address', () => {
        expect(() => resolveHexGroupKey(frostConfig, 'B62qjsV5aGEMBRkVMhEJGRZRG2iGE3t9BkCmTiSJQgVzMQnNGobRVJ')).toThrow(
            /No FROST group found/,
        );
    });

    it('throws for empty config', () => {
        expect(() => resolveHexGroupKey('', groups[1].base58!)).toThrow(
            /No FROST group found/,
        );
    });
});
