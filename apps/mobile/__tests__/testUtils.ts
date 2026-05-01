import React from 'react';
import ReactTestRenderer from 'react-test-renderer';


export function collectTexts(instance: ReactTestRenderer.ReactTestInstance): string[] {
  const texts: string[] = [];
  
  const walk = (node: ReactTestRenderer.ReactTestInstance) => {
    if (typeof node === 'string' || typeof node === 'number') return;
    
    if ((node.type as string) === 'Text') {
      let combinedText = '';
      
      const gather = (children: ReactTestRenderer.ReactTestInstance['children']) => {
        (children ?? []).forEach(child => {
          if (typeof child === 'string' || typeof child === 'number') {
            combinedText += String(child); 
          } else if (child && typeof child === 'object') {
            gather(child.children);
          }
        });
      };
      
      gather(node.children);
      
      if (combinedText) {
        texts.push(combinedText);
      }
      return;
    }
    
    (node.children ?? []).forEach(child => {
      if (typeof child !== 'string' && typeof child !== 'number') {
        walk(child as ReactTestRenderer.ReactTestInstance);
      }
    });
  };
  
  walk(instance);
  return texts;
}

export function hasText(texts: string[], substr: string): boolean {
  return texts.some(t => t.includes(substr));
}

export function createRenderer<P extends object>(Component: React.ComponentType<P>) {
  return (props: P) => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(React.createElement(Component, props));
    });
    return tree;
  };
}