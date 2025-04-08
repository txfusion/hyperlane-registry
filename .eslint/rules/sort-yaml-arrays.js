import YAML from 'yaml';

function sortArrayByKey(array, sortKey) {
  return [...array].sort((a, b) => {
    if (a[sortKey] && b[sortKey]) {
      return a[sortKey].localeCompare(b[sortKey]);
    }
    return 0;
  });
}

function handleWildcardInPath(obj, rest, sortKey) {
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const newObj = { ...obj };
    Object.keys(obj).forEach((key) => {
      newObj[key] = traverseAndSort(obj[key], rest, sortKey);
    });
    return newObj;
  } else if (Array.isArray(obj)) {
    return obj.map((item) => traverseAndSort(item, rest, sortKey));
  }
  return obj;
}

function handleArrayNotation(obj, current, rest, sortKey) {
  const arrayKey = current.slice(0, -2);
  if (obj[arrayKey] && Array.isArray(obj[arrayKey])) {
    const newObj = { ...obj };
    newObj[arrayKey] = obj[arrayKey].map((item) => traverseAndSort(item, rest, sortKey));
    return newObj;
  }
  return obj;
}

function handleLastPathPart(obj, key, sortKey) {
  if (key === '*') {
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      const newObj = { ...obj };
      Object.keys(obj).forEach((propKey) => {
        if (Array.isArray(obj[propKey])) {
          newObj[propKey] = sortArrayByKey(obj[propKey], sortKey);
        }
      });
      return newObj;
    }
    return obj;
  } else if (obj[key] && Array.isArray(obj[key])) {
    const newObj = { ...obj };
    newObj[key] = sortArrayByKey(obj[key], sortKey);
    return newObj;
  }
  return obj;
}

function traverseAndSort(obj, parts, sortKey) {
  if (!obj || typeof obj !== 'object') return obj;

  if (parts.length === 1) {
    return handleLastPathPart(obj, parts[0], sortKey);
  }

  const [current, ...rest] = parts;

  if (current === '*') {
    return handleWildcardInPath(obj, rest, sortKey);
  }

  if (current.endsWith('[]')) {
    return handleArrayNotation(obj, current, rest, sortKey);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => traverseAndSort(item, parts, sortKey));
  }

  if (obj[current]) {
    const newObj = { ...obj };
    newObj[current] = traverseAndSort(obj[current], rest, sortKey);
    return newObj;
  }

  return obj;
}

function processObjectWithConfig(data, sortConfig) {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => processObjectWithConfig(item, sortConfig));
  }

  let result = { ...data };

  sortConfig.arrays.forEach((arrayConfig) => {
    const { path, sortKey } = arrayConfig;
    const pathParts = path.split('.');
    result = traverseAndSort(result, pathParts, sortKey);
  });

  Object.keys(result).forEach((key) => {
    if (typeof result[key] === 'object') {
      result[key] = processObjectWithConfig(result[key], sortConfig);
    }
  });

  return result;
}

function preserveComments(yamlText, sortedText, comments, sourceCode) {
  const originalLines = yamlText.split('\n');
  const sortedLines = sortedText.split('\n');

  const commentMap = new Map();

  comments.forEach((comment) => {
    const commentLine = comment.loc.start.line - 1;
    const commentText = sourceCode.getText(comment);

    let contentLineIndex = commentLine;
    while (contentLineIndex < originalLines.length) {
      const line = originalLines[contentLineIndex];
      if (line && !line.trim().startsWith('#')) {
        if (!commentMap.has(line)) {
          commentMap.set(line, []);
        }
        commentMap.get(line).push({
          text: commentText,
          originalIndex: commentLine,
        });
        break;
      }
      contentLineIndex++;
    }
  });

  const finalLines = [];

  for (const line of sortedLines) {
    if (commentMap.has(line)) {
      const lineComments = commentMap.get(line);

      lineComments.sort((a, b) => a.originalIndex - b.originalIndex);

      lineComments.forEach(({ text }) => {
        finalLines.push(text);
      });
    }

    finalLines.push(line);
  }

  return finalLines.join('\n');
}

export default {
  meta: {
    type: 'layout',
    docs: {
      description: 'Sort YAML arrays based on specified keys',
      category: 'Stylistic Issues',
      recommended: true,
      url: null,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          arrays: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                sortKey: { type: 'string' },
              },
              required: ['path', 'sortKey'],
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const options = context.options[0] || {};
    const sortConfig = {
      arrays: options.arrays || [],
    };

    return {
      Program(node) {
        if (!context.filename.endsWith('.yaml') && !context.filename.endsWith('.yml')) {
          return;
        }

        try {
          const yamlText = sourceCode.getText();
          const yamlData = YAML.parse(yamlText);

          if (!yamlData) return;

          const sortedData = processObjectWithConfig(yamlData, sortConfig);

          const sortedYaml = YAML.stringify(sortedData);
          const originalYaml = YAML.stringify(yamlData);

          if (sortedYaml !== originalYaml) {
            context.report({
              node,
              message: 'YAML arrays should be sorted by specified keys',
              fix(fixer) {
                const comments = sourceCode.getAllComments();

                const parsedDoc = YAML.parseDocument(yamlText, { keepSourceTokens: true });

                const sortedData = processObjectWithConfig(parsedDoc.toJSON(), sortConfig);

                const newDoc = new YAML.Document();
                newDoc.contents = sortedData;

                const sortedText = newDoc.toString();

                const finalText = preserveComments(yamlText, sortedText, comments, sourceCode);

                return fixer.replaceText(node, finalText);
              },
            });
          }
        } catch (error) {
          context.report({
            node,
            message: `Error processing YAML: ${error.message}`,
          });
        }
      },
    };
  },
};
