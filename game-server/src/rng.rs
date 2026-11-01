//! Gerador de números aleatórios injetável: o mesmo xorshift32 do `rng()` de servers/world/mobs.ts (mesma semente →
//! mesmas posições iniciais dos mobs) e uma sequência fixa para os testes de equivalência com o Node.

pub trait Rng {
    /// valor em [0, 1)
    fn next_f64(&mut self) -> f64;

    /// `rand(min, max)` do combat.ts: inteiro em [min, max]; consome um sorteio só se max > min
    fn range(&mut self, min: i64, max: i64) -> i64 {
        if max > min { min + (self.next_f64() * (max - min + 1) as f64).floor() as i64 } else { min }
    }
}

pub struct Xorshift32(u32);

impl Xorshift32 {
    pub fn new(seed: u32) -> Self { Xorshift32(if seed == 0 { 1 } else { seed }) }
}

impl Rng for Xorshift32 {
    fn next_f64(&mut self) -> f64 {
        let mut s = self.0;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.0 = s;
        s as f64 / 4294967296.0
    }
}

/// Sequência fixa (cicla): reproduz os `Math.random()` forçados dos vetores gerados pelo Node.
pub struct SeqRng { seq: Vec<f64>, i: usize }

impl SeqRng {
    pub fn new(seq: Vec<f64>) -> Self { SeqRng { seq, i: 0 } }
}

impl Rng for SeqRng {
    fn next_f64(&mut self) -> f64 {
        let v = self.seq[self.i % self.seq.len()];
        self.i += 1;
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn xorshift_matches_js() {
        // valores de rng(12345) em servers/world/mobs.ts, impressos pelo Node
        let mut r = Xorshift32::new(12345);
        assert_eq!(r.next_f64(), 0.776938705239445);
        assert_eq!(r.next_f64(), 0.3951726963277906);
        assert_eq!(r.next_f64(), 0.6557702794671059);
    }
}
