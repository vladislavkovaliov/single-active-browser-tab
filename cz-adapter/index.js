import { rawlist } from '@inquirer/prompts';
import inquirer from 'inquirer';

export default {
  prompter: async (_, commit) => {
    const type = await rawlist({
      message: "Select the type of change you're committing:",
      choices: [
        { name: 'feat: A new feature', value: 'feat' },
        { name: 'fix: A bug fix', value: 'fix' },
        { name: 'chore: Maintenance / chores', value: 'chore' },
        { name: 'docs: Documentation only', value: 'docs' },
        { name: 'style: Code style / formatting', value: 'style' },
        { name: 'refactor: Code refactoring', value: 'refactor' },
        { name: 'perf: Performance improvements', value: 'perf' },
        { name: 'test: Adding or fixing tests', value: 'test' },
      ],
    });

    const { ticket, subject } = await inquirer.prompt([
      {
        type: 'input',
        name: 'subject',
        message: 'Write a short description of the change:',
        validate: (input) => (input ? true : 'Description is required'),
      },
    ]);

    const message = `${type}: ${subject}`;

    commit(message);
  },
};
