"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface FlipWordsProps {
  words: string[];
  duration?: number;
  className?: string;
}

export function FlipWords({ words, duration = 3000, className = "" }: FlipWordsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const currentWord = words[currentIndex];

  const startAnimation = useCallback(() => {
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % words.length);
      setIsAnimating(false);
    }, 600);
  }, [words.length]);

  useEffect(() => {
    const interval = setInterval(startAnimation, duration);
    return () => clearInterval(interval);
  }, [startAnimation, duration]);

  return (
    <span className={`inline-block relative ${className}`}>
      <AnimatePresence mode="wait">
        <motion.span
          key={currentWord}
          className="inline-flex"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          {/* Visible word with character-level animation */}
          {currentWord.split("").map((char, i) => (
            <motion.span
              key={`${currentWord}-${i}`}
              className="inline-block"
              style={{ whiteSpace: char === " " ? "pre" : "normal" }}
              initial={{
                opacity: 0,
                y: 12,
                filter: "blur(8px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              exit={{
                opacity: 0,
                y: -8 + Math.random() * -20,
                x: (Math.random() - 0.5) * 30,
                filter: "blur(6px)",
                scale: 0.5 + Math.random() * 0.5,
                rotate: (Math.random() - 0.5) * 40,
              }}
              transition={{
                duration: 0.35,
                delay: i * 0.03,
                ease: "easeOut",
              }}
            >
              {char}
            </motion.span>
          ))}

          {/* Particle layer — bronze dots that scatter on exit */}
          {isAnimating && (
            <span className="absolute inset-0 pointer-events-none">
              {Array.from({ length: 14 }).map((_, i) => (
                <motion.span
                  key={`particle-${i}`}
                  className="absolute rounded-full"
                  style={{
                    width: 2 + Math.random() * 3,
                    height: 2 + Math.random() * 3,
                    background: `rgba(155, 123, 91, ${0.4 + Math.random() * 0.5})`,
                    left: `${Math.random() * 100}%`,
                    top: `${30 + Math.random() * 40}%`,
                  }}
                  initial={{ opacity: 1, scale: 1 }}
                  animate={{
                    opacity: 0,
                    scale: 0,
                    y: -20 - Math.random() * 40,
                    x: (Math.random() - 0.5) * 60,
                  }}
                  transition={{
                    duration: 0.5 + Math.random() * 0.4,
                    delay: Math.random() * 0.2,
                    ease: "easeOut",
                  }}
                />
              ))}
            </span>
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
